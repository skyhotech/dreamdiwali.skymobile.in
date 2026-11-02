import json
import secrets
import threading
import time
from datetime import timedelta

from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth.views import LoginView
from django.db import close_old_connections, transaction
from django.core.cache import cache
from django.http import JsonResponse, StreamingHttpResponse
from django.db.models import Count, Max
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from .images import POSTER_SIZE, SELFIE_SIZE, THUMB_SIZE, compressed_photo, optimized
from .models import REWARD_IDS, Customer, Mirror
from .serializers import (
    CustomerSerializer,
    CustomerUploadSerializer,
    RegisterSerializer,
    SpinSerializer,
    MirrorSerializer,
    PublicMirrorSerializer,
)
from .throttles import (
    client_ip,
    CustomerRegisterThrottle,
    CustomerSpinThrottle,
    PhoneThrottle,
    CustomerUploadThrottle,
    MirrorPollThrottle,
    MirrorVersionThrottle,
)

# Photo compression is CPU-bound; one at a time per server process.
_IMAGE_WORK = threading.BoundedSemaphore(1)
IMAGE_WAIT_SECONDS = 25


# --- Public API used by the selfie studio ---------------------------------


class PublicMirrorList(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [MirrorPollThrottle]

    def get(self, request):
        mirrors = Mirror.objects.filter(is_active=True)
        return Response(PublicMirrorSerializer(mirrors, many=True, context={"request": request}).data)


class PublicMirrorVersion(APIView):
    """Tiny fingerprint of the active theme list; the studio polls it every second."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [MirrorVersionThrottle]

    def get(self, request):
        return Response({"version": mirrors_version()})


def mirrors_version():
    agg = Mirror.objects.aggregate(updated=Max("updated_at"), n=Count("id"))
    updated = agg["updated"].timestamp() if agg["updated"] else 0
    # Count catches deletes, which leave no newer updated_at behind.
    return f"{updated:.6f}-{agg['n']}"


# Server-sent events: the studio holds this connection open and receives the
# full theme list the moment an admin saves. Plain Django, no extra services.
STREAM_CHECK_SECONDS = 0.3
STREAM_HEARTBEAT_SECONDS = 15
# Connections are recycled so a threaded dev server never pins workers forever;
# EventSource reconnects automatically.
STREAM_LIFETIME_SECONDS = 300


MAX_STREAMS_PER_IP = 20


def mirror_stream(request):
    # Each open stream holds a worker thread; cap them per network.
    ip = client_ip(request)
    key = f"mirror-streams:{ip}"
    cache.add(key, 0, timeout=STREAM_LIFETIME_SECONDS + 60)
    if cache.incr(key) > MAX_STREAMS_PER_IP:
        cache.decr(key)
        return JsonResponse({"detail": "Too many live connections."}, status=429)

    def events():
        last, last_beat, started = None, time.monotonic(), time.monotonic()
        yield "retry: 1000\n\n"
        try:
            while time.monotonic() - started < STREAM_LIFETIME_SECONDS:
                version = mirrors_version()
                if version != last:
                    last = version
                    data = PublicMirrorSerializer(
                        Mirror.objects.filter(is_active=True), many=True,
                        context={"request": request},
                    ).data
                    yield f"event: mirrors\ndata: {json.dumps(data)}\n\n"
                    last_beat = time.monotonic()
                elif time.monotonic() - last_beat > STREAM_HEARTBEAT_SECONDS:
                    yield ": ping\n\n"
                    last_beat = time.monotonic()
                close_old_connections()
                time.sleep(STREAM_CHECK_SECONDS)
        finally:
            close_old_connections()
            try:
                cache.decr(key)
            except ValueError:
                pass

    response = StreamingHttpResponse(events(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"  # stop nginx from buffering events
    return response


class CustomerUpload(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CustomerUploadThrottle]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = CustomerUploadSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        data = upload.validated_data
        mirror = Mirror.objects.filter(slug=data.get("mirror") or "").first()
        # One vCPU: compress one upload at a time per process so a rush of
        # uploads queues briefly instead of slowing every request down.
        if not _IMAGE_WORK.acquire(timeout=IMAGE_WAIT_SECONDS):
            return Response(
                {"detail": "SKY is busy saving other photos. Retrying shortly."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
                headers={"Retry-After": "10"},
            )
        try:
            # Compress photos to ≤200 KB at the highest quality that fits.
            for field, size in (("poster", POSTER_SIZE), ("selfie", SELFIE_SIZE)):
                if field in data:
                    data[field] = compressed_photo(data[field], size) or data[field]
            thumbs = {"poster_thumb": optimized(data["poster"], THUMB_SIZE, 78) or ""}
            if "selfie" in data:
                thumbs["selfie_thumb"] = optimized(data["selfie"], THUMB_SIZE, 78) or ""
        finally:
            _IMAGE_WORK.release()
        replaced = []
        with transaction.atomic():
            # Registered customers are matched by mobile number, others by session.
            lookup = (
                {"phone": data["phone"]} if data.get("phone") else {"session": data["session"]}
            )
            customer, created = Customer.objects.select_for_update().get_or_create(
                **lookup, defaults={"session": data["session"], "poster": data["poster"]}
            )
            # Old files are deleted only after the new ones are saved, so a
            # failed save never leaves a customer without photos.
            if not created:
                if customer.poster:
                    replaced.append(customer.poster.name)
                customer.poster = data["poster"]
            for thumb in ("poster_thumb", "selfie_thumb"):
                if getattr(customer, thumb):
                    replaced.append(getattr(customer, thumb).name)
            customer.poster_thumb = thumbs["poster_thumb"]
            if "selfie" in data:
                if customer.selfie:
                    replaced.append(customer.selfie.name)
                customer.selfie = data["selfie"]
                customer.selfie_thumb = thumbs["selfie_thumb"]
            customer.mirror = mirror
            customer.mirror_name = mirror.name if mirror else data.get("mirror", "")
            if data.get("name"):
                customer.name = data["name"]
            # The first prize is final; later uploads can't change it.
            if data.get("reward") in REWARD_IDS and not customer.reward:
                customer.reward = data["reward"]
            customer.save()
        for name in replaced:
            if name:
                customer.poster.storage.delete(name)
        return Response(
            {"id": customer.pk},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class CustomerRegister(APIView):
    """Sign-in by mobile number. Returns the customer's prize if they already spun."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CustomerRegisterThrottle, PhoneThrottle]

    def post(self, request):
        ser = RegisterSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        phone = ser.validated_data["phone"]
        customer, created = Customer.objects.get_or_create(
            phone=phone, defaults={"session": f"phone-{phone}"}
        )
        if not customer.consent_at:
            customer.consent_at = timezone.now()
            customer.save(update_fields=["consent_at", "updated_at"])
        return Response(
            {"phone": phone, "reward": customer.reward or None, "returning": not created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


# Euclidean distance between face-api fingerprints; under 0.5 is the same
# person in face-api's own guidance. Slightly stricter to avoid false matches.
FACE_MATCH_DISTANCE = 0.45


def _face_distance(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def _find_same_face(face, exclude_id):
    best, best_distance = None, FACE_MATCH_DISTANCE
    rows = (
        Customer.objects.exclude(pk=exclude_id)
        .exclude(reward="")
        .filter(face__isnull=False, consent_at__isnull=False)
        .values_list("id", "face")
    )
    for pk, other in rows.iterator():
        if isinstance(other, list) and len(other) == len(face):
            d = _face_distance(face, other)
            if d < best_distance:
                best, best_distance = pk, d
    return best


class CustomerSpin(APIView):
    """Picks the prize on the server: once per mobile number, and once per face."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CustomerSpinThrottle, PhoneThrottle]

    def post(self, request):
        ser = SpinSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        face = ser.validated_data.get("face")
        with transaction.atomic():
            customer = (
                Customer.objects.select_for_update()
                .filter(phone=ser.validated_data["phone"], consent_at__isnull=False)
                .first()
            )
            if customer is None:
                return Response({"phone": "Register this number first."}, status=400)
            if customer.reward:
                return Response({"reward": customer.reward, "repeat": bool(customer.repeat_of_id)})
            if face:
                customer.face = [round(x, 5) for x in face]
                match = _find_same_face(customer.face, customer.pk)
                if match:
                    # Same person, new number: give back the prize they already won.
                    earlier = Customer.objects.get(pk=match)
                    customer.reward = earlier.reward
                    customer.repeat_of = earlier
            if not customer.reward:
                customer.reward = secrets.choice(REWARD_IDS)
            customer.save(update_fields=["reward", "face", "repeat_of", "updated_at"])
        return Response({"reward": customer.reward, "repeat": bool(customer.repeat_of_id)})


# --- Staff API used by /sky/mirror/admin/ -----------------------------------


class AdminPagination(PageNumberPagination):
    page_size = 24
    page_size_query_param = "page_size"
    max_page_size = 100


class MirrorViewSet(viewsets.ModelViewSet):
    serializer_class = MirrorSerializer
    permission_classes = [IsAdminUser]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        return Mirror.objects.annotate(customer_count=Count("customers"))

    def perform_create(self, serializer):
        last = Mirror.objects.order_by("-order").values_list("order", flat=True).first()
        serializer.save(order=(last or 0) + 1)

    def perform_update(self, serializer):
        old_artwork = serializer.instance.artwork.name
        mirror = serializer.save()
        if old_artwork and mirror.artwork.name != old_artwork:
            mirror.artwork.storage.delete(old_artwork)

    def perform_destroy(self, instance):
        instance.artwork.delete(save=False)
        instance.delete()

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        ids = request.data.get("ids")
        if not isinstance(ids, list):
            return Response({"ids": "Expected a list of mirror ids."}, status=400)
        with transaction.atomic():
            for position, pk in enumerate(ids, start=1):
                Mirror.objects.filter(pk=pk).update(order=position, updated_at=timezone.now())
        return Response({"ok": True})


class CustomerViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = CustomerSerializer
    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def get_queryset(self):
        qs = Customer.objects.select_related("mirror")
        mirror = self.request.query_params.get("mirror")
        if mirror:
            qs = qs.filter(mirror_id=mirror)
        search = self.request.query_params.get("q")
        if search:
            qs = qs.filter(name__icontains=search) | qs.filter(phone__icontains=search)
        return qs

    def perform_destroy(self, instance):
        for f in (instance.poster, instance.selfie, instance.poster_thumb, instance.selfie_thumb):
            if f:
                f.delete(save=False)
        instance.delete()

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        """All customers as CSV, so staff always have an offline copy."""
        import csv

        from django.http import HttpResponse

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = (
            f'attachment; filename="sky-customers-{timezone.localdate():%Y%m%d}.csv"'
        )
        writer = csv.writer(response)
        writer.writerow(["id", "phone", "name", "mirror", "reward", "same_face_as",
                         "consent_at", "created_at", "poster_url", "selfie_url"])
        for c in Customer.objects.select_related("repeat_of").order_by("created_at"):
            writer.writerow([
                c.pk, c.phone, c.name, c.mirror_name, c.reward,
                c.repeat_of.phone if c.repeat_of else "",
                c.consent_at.isoformat() if c.consent_at else "",
                c.created_at.isoformat(),
                request.build_absolute_uri(c.poster.url) if c.poster else "",
                request.build_absolute_uri(c.selfie.url) if c.selfie else "",
            ])
        return response


@api_view(["GET"])
@permission_classes([IsAdminUser])
def stats(request):
    today = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    per_day = []
    for offset in range(6, -1, -1):
        start = today - timedelta(days=offset)
        per_day.append({
            "date": start.date().isoformat(),
            "count": Customer.objects.filter(
                created_at__gte=start, created_at__lt=start + timedelta(days=1)
            ).count(),
        })
    top = (
        Mirror.objects.annotate(n=Count("customers"))
        .order_by("-n")
        .values("id", "name", "n")[:5]
    )
    return Response({
        "mirrors": Mirror.objects.count(),
        "active_mirrors": Mirror.objects.filter(is_active=True).count(),
        "customers": Customer.objects.count(),
        "customers_today": Customer.objects.filter(created_at__gte=today).count(),
        "per_day": per_day,
        "top_mirrors": list(top),
    })


@staff_member_required(login_url="mirror-login")
@ensure_csrf_cookie
def dashboard(request):
    return render(request, "mirrors/dashboard.html")


class LockoutLoginView(LoginView):
    """Staff login that locks a username or network out after repeated failures."""

    template_name = "mirrors/login.html"
    max_failures = 5
    lockout_seconds = 15 * 60

    def _keys(self):
        ip = client_ip(self.request)
        user = self.request.POST.get("username", "").strip().lower()[:150]
        return [f"login-fail:ip:{ip}", f"login-fail:user:{user}"]

    def _locked(self):
        return any((cache.get(k) or 0) >= self.max_failures for k in self._keys())

    def post(self, request, *args, **kwargs):
        if self._locked():
            form = self.get_form()
            form.is_valid()  # populate cleaned_data without trying the password
            form.errors.clear()
            form.add_error(None, "Too many failed sign-ins. Try again in 15 minutes.")
            return self.render_to_response(self.get_context_data(form=form))
        return super().post(request, *args, **kwargs)

    def form_invalid(self, form):
        for key in self._keys():
            cache.add(key, 0, timeout=self.lockout_seconds)
            cache.incr(key)
        return super().form_invalid(form)

    def form_valid(self, form):
        cache.delete_many(self._keys())
        return super().form_valid(form)
