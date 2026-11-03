import json
import secrets
import threading
import time
from datetime import timedelta

from django.conf import settings
from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth.views import LoginView
from django.db import IntegrityError, close_old_connections, transaction
from django.core.cache import cache
from django.http import JsonResponse, StreamingHttpResponse
from django.db.models import Avg, Count, Max, Q, Sum
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .images import POSTER_SIZE, SELFIE_SIZE, THUMB_SIZE, compressed_photo, optimized
from .models import Branch, Customer, CustomerEvent, Mirror, SpinItem
from .serializers import (
    BranchSerializer,
    PublicBranchSerializer,
    branch_link,
    spin_link,
    ApprovalSerializer,
    CustomerDetailSerializer,
    CustomerEventSerializer,
    CustomerIntakeSerializer,
    EventSerializer,
    ProfileSerializer,
    ReviewSerializer,
    TermsSerializer,
    SpinItemSerializer,
    wheel_items,
    CustomerSerializer,
    CustomerUploadSerializer,
    SpinSerializer,
    MirrorSerializer,
    PublicMirrorSerializer,
)
from .throttles import (
    client_ip,
    CustomerRegisterThrottle,
    CustomerSpinThrottle,
    ManagerThrottle,
    RepeatThrottle,
    CustomerUploadThrottle,
    MirrorPollThrottle,
    MirrorVersionThrottle,
)

# Photo compression is CPU-bound; one at a time per server process.
_IMAGE_WORK = threading.BoundedSemaphore(1)
IMAGE_WAIT_SECONDS = 25

NO_TERMS = "Please accept the terms and conditions first."
NO_GIFTS = "Gifts aren't set up yet. Please ask the SKY team."
_DRAW = secrets.SystemRandom()
INVALID_LINK = "This gift link isn't valid. Please ask the SKY team for a new one."

INACTIVE_BRANCH = (
    "This store link is no longer active. Please ask the SKY team for the current QR code."
)


def _link_unsent(customers):
    """Abandoned after passing: checked, but the WhatsApp link never went out."""
    return customers.filter(spin_token__isnull=False).exclude(events__kind="whatsapp_sent")


def _failed_attempts():
    """Abandoned at the check: each number's latest refusal, dropped as soon as
    that number passes or an admin approves or dismisses it."""
    passed = Customer.objects.filter(spin_token__isnull=False).values("phone")
    rows, seen = [], set()
    failed = CustomerEvent.objects.filter(kind="check_failed").exclude(phone__in=passed)
    for event in failed.order_by("-created_at"):
        if event.detail.get("resolved"):
            seen.add(event.phone)
            continue
        if not event.phone or event.phone not in seen:
            seen.add(event.phone)
            rows.append(event)
    return rows


def _branch(slug, strict=True):
    """The branch a studio link points at; None without one. A link to an
    unknown or switched-off branch is refused rather than filed nowhere,
    except for uploads already queued on a phone (strict=False), which must
    never be lost because a branch was switched off meanwhile."""
    if not slug:
        return None
    if not strict:
        return Branch.objects.filter(slug=slug).first()
    branch = Branch.objects.filter(slug=slug, is_active=True).first()
    if branch is None:
        raise ValidationError({"branch": [INACTIVE_BRANCH]})
    return branch


def _log(customer, kind, **detail):
    CustomerEvent.objects.create(
        customer=customer, phone=customer.phone, kind=kind, detail=detail
    )


def _file_under(customer, branch):
    """Files a customer under the branch whose link they used, once: the store
    where they first came in keeps them. Returns the fields that changed."""
    if branch is None or customer.branch_id:
        return []
    customer.branch, customer.branch_name = branch, branch.name
    return ["branch", "branch_name"]



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
    throttle_classes = [CustomerUploadThrottle, RepeatThrottle]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = CustomerUploadSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        data = upload.validated_data
        mirror = Mirror.objects.filter(slug=data.get("mirror") or "").first()
        branch = _branch(data.get("branch"), strict=False)
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
            _file_under(customer, branch)
            if data.get("name"):
                customer.name = data["name"]
            customer.save()
        for name in replaced:
            if name:
                customer.poster.storage.delete(name)
        _log(customer, "poster_saved", mirror=customer.mirror_name)
        return Response(
            # Public poster address, for sharing it as a link.
            {"id": customer.pk, "poster": customer.poster.url if customer.poster else None},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class CustomerLink(APIView):
    """Who a WhatsApp link belongs to, and their prize if they already spun."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CustomerRegisterThrottle, RepeatThrottle]

    def get(self, request, token):
        customer = Customer.objects.filter(spin_token=token).first()
        if customer is None:
            return Response({"detail": INVALID_LINK}, status=status.HTTP_404_NOT_FOUND)
        _log(customer, "link_opened", version=customer.link_version)
        # The wheel shows every gift; the bill decides only which one is won
        # (CustomerSpin), so a range with a single gift still spins a full wheel.
        items = list(SpinItem.objects.filter(is_active=True))
        won = SpinItem.objects.filter(slug=customer.reward).first()
        if won and won not in items:
            items.append(won)
        return Response({
            "phone": customer.phone, "name": customer.name, "reward": customer.reward or None,
            "items": wheel_items(items),
            "next": customer.next_step,
            "video_review": customer.video_review,
            "poster": customer.poster.url if customer.poster else None,
        })


class CustomerSpin(APIView):
    """Picks the prize on the server, once per customer. Only the token from
    the WhatsApp link can spin; the selfie comes after the prize."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CustomerSpinThrottle, RepeatThrottle]

    def post(self, request):
        ser = SpinSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            customer = (
                Customer.objects.select_for_update()
                .filter(spin_token=ser.validated_data["token"])
                .first()
            )
            if customer is None:
                return Response({"detail": INVALID_LINK}, status=status.HTTP_404_NOT_FOUND)
            if not customer.terms_accepted_at:
                return Response({"detail": NO_TERMS}, status=status.HTTP_400_BAD_REQUEST)
            if not customer.reward:
                items = SpinItem.for_bill(customer.bill_value)
                if not items:
                    return Response({"detail": NO_GIFTS}, status=status.HTTP_400_BAD_REQUEST)
                customer.reward = _DRAW.choices(items, [max(i.weight, 1) for i in items])[0].slug
                customer.save(update_fields=["reward", "updated_at"])
                _log(customer, "spun", reward=customer.reward)
        return Response({"reward": customer.reward})


# --- Store manager API ------------------------------


class ManagerBranches(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ManagerThrottle, RepeatThrottle]

    def get(self, request):
        branches = Branch.objects.filter(is_active=True)
        return Response(PublicBranchSerializer(branches, many=True).data)


def _save_purchase(data, branch, **log):
    """Files a checked purchase (by the manager's check or an admin's
    approval) and gives it a spin link."""
    try:
        with transaction.atomic():
            customer = Customer.objects.select_for_update().filter(phone=data["phone"]).first()
            if customer and customer.reward:
                raise ValidationError({"phone": ["This customer has already claimed a gift."]})
            others = Customer.objects.exclude(pk=customer.pk if customer else None)
            if data["imei"] and others.filter(imei=data["imei"]).exists():
                raise ValidationError({"imei": ["This IMEI is already registered."]})
            if others.filter(branch=branch, invoice_number=data["invoice_number"]).exists():
                raise ValidationError(
                    {"invoice_number": ["This invoice is already registered at this branch."]}
                )
            customer = customer or Customer(
                phone=data["phone"], session=f"phone-{data['phone']}"
            )
            new = customer.pk is None
            # Changed details get a fresh link; the old one stops working.
            changed = not new and (
                customer.name, customer.email, customer.product_details, customer.imei,
                customer.invoice_number, customer.bill_value, customer.branch_id,
            ) != (
                data["name"], data.get("email", ""), data["product_details"], data["imei"],
                data["invoice_number"], data["bill_value"], branch.pk,
            )
            customer.name = data["name"]
            customer.email = data.get("email", "")
            customer.product_details = data["product_details"]
            customer.imei = data["imei"]
            customer.invoice_number = data["invoice_number"]
            customer.bill_value = data["bill_value"]
            customer.branch, customer.branch_name = branch, branch.name
            customer.consent_at = customer.consent_at or timezone.now()
            customer.ocr_text = data["ocr_text"]
            customer.blur_score = data["blur_score"]
            if changed or not customer.spin_token:
                customer.spin_token = secrets.token_urlsafe(24)
                customer.link_version += 1
            customer.save()
            _log(customer, "checked", version=customer.link_version, link_changed=changed, **log)
    except IntegrityError:
        # Two counters submitted the same purchase at the same moment.
        raise ValidationError({"imei": ["This purchase is already registered."]})
    return customer


class ManagerCheck(APIView):
    """Checks a purchase and, if it holds up, saves it and returns the spin
    link. Pressing Check again after a correction updates the same customer
    until they have spun."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ManagerThrottle, RepeatThrottle]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        try:
            return self.check(request)
        except ValidationError as exc:
            CustomerEvent.objects.create(
                phone=str(request.data.get("phone", ""))[:20], kind="check_failed",
                detail={
                    "errors": json.loads(json.dumps(exc.detail, default=str)),
                    **{
                        field: str(request.data.get(field, ""))[:160]
                        for field in ("branch", "name", "email", "product_details",
                                      "imei", "invoice_number", "bill_value")
                    },
                    # What the scanner read, to see why a real bill was refused.
                    "ocr_text": (cache.get(f"invoice-scan:{request.data.get('scan', '')}") or "")[:4000],
                },
            )
            raise

    def check(self, request):
        ser = CustomerIntakeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        customer = _save_purchase(data, _branch(data["branch"]))
        return Response({"phone": customer.phone, "link": spin_link(customer.spin_token)})


# OCR is CPU-heavy: at most three invoices are read at once per worker.
_OCR_WORK = threading.BoundedSemaphore(3)
SCAN_SECONDS = 30 * 60


class ManagerScan(APIView):
    """Reads an uploaded invoice (photo or PDF) on the server and keeps the
    text briefly for the check. The file itself is never stored."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ManagerThrottle]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        from .extract import UnreadableInvoice, extract_text

        upload = request.FILES.get("invoice")
        if upload is None:
            return Response({"invoice": ["Upload the invoice image or PDF."]}, status=400)
        if not _OCR_WORK.acquire(timeout=IMAGE_WAIT_SECONDS):
            return Response(
                {"detail": "SKY is busy reading other invoices. Please try again."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE, headers={"Retry-After": "5"},
            )
        try:
            text = extract_text(upload.read(), upload.name)
        except UnreadableInvoice as exc:
            return Response({"invoice": [str(exc)]}, status=400)
        finally:
            _OCR_WORK.release()
        scan = secrets.token_urlsafe(16)
        cache.set(f"invoice-scan:{scan}", text, SCAN_SECONDS)
        return Response({"scan": scan, "text": text})


class ManagerSent(APIView):
    """The manager opened WhatsApp with this customer's link."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ManagerThrottle, RepeatThrottle]

    def post(self, request):
        customer = Customer.objects.filter(phone=str(request.data.get("phone", ""))).first()
        if customer is None:
            return Response({"detail": "Customer not found."}, status=404)
        _log(customer, "whatsapp_sent", version=customer.link_version)
        return Response({"ok": True})


class CustomerTerms(APIView):
    """Terms accepted on the link's first screen; no spin without them."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CustomerSpinThrottle, RepeatThrottle]

    def post(self, request):
        ser = TermsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        customer = Customer.objects.filter(spin_token=ser.validated_data["token"]).first()
        if customer is None:
            return Response({"detail": INVALID_LINK}, status=status.HTTP_404_NOT_FOUND)
        data = ser.validated_data
        customer.terms_accepted_at = customer.terms_accepted_at or timezone.now()
        customer.video_review = data["video_review"]
        customer.instagram_id = data.get("instagram_id", "").lstrip("@") if data["video_review"] else ""
        customer.save(update_fields=["terms_accepted_at", "video_review", "instagram_id", "updated_at"])
        _log(customer, "terms_accepted", video_review=customer.video_review)
        return Response({"next": customer.next_step})


class CustomerReview(APIView):
    """Star rating and review, given after the spin."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CustomerSpinThrottle, RepeatThrottle]

    def post(self, request):
        ser = ReviewSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        customer = Customer.objects.filter(spin_token=ser.validated_data["token"]).first()
        if customer is None:
            return Response({"detail": INVALID_LINK}, status=status.HTTP_404_NOT_FOUND)
        if not customer.reward:
            return Response({"detail": "Spin the wheel first."}, status=status.HTTP_400_BAD_REQUEST)
        customer.rating = ser.validated_data["rating"]
        customer.review = ser.validated_data.get("review", "").strip()
        customer.save(update_fields=["rating", "review", "updated_at"])
        _log(customer, "reviewed", rating=customer.rating)
        return Response({"next": customer.next_step})


LIVE_KEY = "live-visitors"
LIVE_SECONDS = 70  # visitors ping every 30 s; two misses and they're gone


def live_visitors():
    """Open pages right now, newest first: who (customer or manager) and where."""
    now = time.time()
    rows = []
    for visitor, seen in (cache.get(LIVE_KEY) or {}).items():
        seen = seen if isinstance(seen, dict) else {"t": seen}
        if now - seen["t"] < LIVE_SECONDS:
            rows.append({"id": visitor, "seconds_ago": round(now - seen["t"]),
                         "role": seen.get("role", ""), "screen": seen.get("screen", "")})
    return sorted(rows, key=lambda r: r["seconds_ago"])


def live_count():
    return len(live_visitors())


class ClientError(APIView):
    """A crash on a customer's phone, with its browser, to fix pages that
    break only on some phones."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [MirrorPollThrottle]

    def post(self, request):
        detail = {k: str(request.data.get(k, ""))[:1500] for k in ("where", "message", "stack", "url")}
        detail["browser"] = request.headers.get("User-Agent", "")[:300]
        CustomerEvent.objects.create(kind="client_error", detail=detail)
        return Response(status=status.HTTP_204_NO_CONTENT)


class LivePing(APIView):
    """A customer page saying it is still open, for the admin's live count."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [MirrorPollThrottle]

    def post(self, request):
        visitor = str(request.data.get("id", ""))[:40]
        if visitor:
            now = time.time()
            seen = {
                k: v for k, v in (cache.get(LIVE_KEY) or {}).items()
                if now - (v["t"] if isinstance(v, dict) else v) < LIVE_SECONDS
            }
            seen[visitor] = {
                "t": now,
                "role": str(request.data.get("role", ""))[:20],
                "screen": str(request.data.get("screen", ""))[:40],
            }
            cache.set(LIVE_KEY, seen, LIVE_SECONDS * 2)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerEventView(APIView):
    """Records which share button a customer pressed."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CustomerSpinThrottle, RepeatThrottle]

    def post(self, request):
        ser = EventSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        customer = Customer.objects.filter(spin_token=ser.validated_data["token"]).first()
        if customer is None:
            return Response({"detail": INVALID_LINK}, status=status.HTTP_404_NOT_FOUND)
        url = ser.validated_data.get("url", "")
        _log(customer, ser.validated_data["kind"], **({"url": url} if url else {}))
        return Response({"ok": True})


class CustomerProfile(APIView):
    """The Instagram ID or Facebook profile a customer shares from."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CustomerSpinThrottle]

    def post(self, request):
        ser = ProfileSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        customer = Customer.objects.filter(spin_token=ser.validated_data["token"]).first()
        if customer is None:
            return Response({"detail": INVALID_LINK}, status=status.HTTP_404_NOT_FOUND)
        platform, handle = ser.validated_data["platform"], ser.validated_data["handle"]
        field = "instagram_id" if platform == "instagram" else "facebook_profile"
        setattr(customer, field, handle)
        customer.save(update_fields=[field, "updated_at"])
        _log(customer, f"profile_{platform}", handle=handle)
        return Response({"handle": handle})


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

    def get_serializer_class(self):
        return CustomerDetailSerializer if self.action == "retrieve" else CustomerSerializer

    def get_queryset(self):
        qs = Customer.objects.select_related("mirror").prefetch_related("events")
        if self.request.query_params.get("abandoned"):
            qs = _link_unsent(qs)
        reached = self.request.query_params.get("reached")
        if reached == "shared":
            qs = qs.filter(events__kind__in=CustomerEvent.SHARE_KINDS).distinct()
        elif reached:
            qs = qs.filter(events__kind=reached).distinct()
        mirror = self.request.query_params.get("mirror")
        if mirror:
            qs = qs.filter(mirror_id=mirror)
        branch = self.request.query_params.get("branch")
        if branch == "none":
            qs = qs.filter(branch__isnull=True)
        elif branch:
            qs = qs.filter(branch_id=branch)
        search = self.request.query_params.get("q")
        if search:
            qs = qs.filter(
                Q(name__icontains=search) | Q(phone__icontains=search)
                | Q(imei__icontains=search) | Q(invoice_number__icontains=search)
            )
        return qs

    def perform_destroy(self, instance):
        for f in (instance.poster, instance.selfie, instance.poster_thumb, instance.selfie_thumb,
                  instance.invoice_image):
            if f:
                f.delete(save=False)
        instance.delete()

    @action(detail=False, methods=["get"])
    def failed(self, request):
        """Latest checks that were refused; these never became customers."""
        rows = CustomerEvent.objects.filter(kind="check_failed").order_by("-created_at")[:200]
        return Response(CustomerEventSerializer(rows, many=True).data)

    @action(detail=False, methods=["get"])
    def abandoned(self, request):
        """Everyone who filled the form but never got a link."""
        unsent = CustomerSerializer(
            _link_unsent(Customer.objects.all()).order_by("-created_at")[:200], many=True
        ).data
        return Response({
            "link_not_sent": unsent,
            "check_failed": CustomerEventSerializer(_failed_attempts()[:200], many=True).data,
        })

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
        writer.writerow(["id", "phone", "name", "branch", "mirror", "reward", "same_face_as",
                         "consent_at", "created_at", "poster_url", "selfie_url", "stage", "rating", "review", "terms_accepted_at", "video_review",
                         "instagram_id", "email",
                         "product_details", "imei", "invoice_number", "bill_value",
                         "invoice_image_url"])
        rows = Customer.objects.select_related("repeat_of").order_by("created_at")
        if request.query_params.get("branch"):
            rows = rows.filter(branch_id=request.query_params["branch"])
        if request.query_params.get("abandoned"):
            rows = _link_unsent(rows)
        for c in rows:
            writer.writerow([
                c.pk, c.phone, c.name, c.branch_name, c.mirror_name, c.reward,
                c.repeat_of.phone if c.repeat_of else "",
                c.consent_at.isoformat() if c.consent_at else "",
                c.created_at.isoformat(),
                request.build_absolute_uri(c.poster.url) if c.poster else "",
                request.build_absolute_uri(c.selfie.url) if c.selfie else "",
                c.stage, c.rating or "", c.review,
                c.terms_accepted_at.isoformat() if c.terms_accepted_at else "",
                "yes" if c.video_review else "no", c.instagram_id, c.email, c.product_details, c.imei, c.invoice_number, c.bill_value or "",
                request.build_absolute_uri(c.invoice_image.url) if c.invoice_image else "",
            ])
        return response


def _platform_counts(customers, kinds):
    """{"whatsapp": 3, ...}: how many such events per platform."""
    rows = (
        CustomerEvent.objects.filter(customer__in=customers, kind__in=kinds)
        .values("kind").annotate(n=Count("id"))
    )
    return {r["kind"].rsplit("_", 1)[1]: r["n"] for r in rows}


def _customer_stats(customers):
    """Counts the dashboard shows, for all customers or one branch."""
    today = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    days = [today - timedelta(days=offset) for offset in range(6, -1, -1)]
    # Counts that used to take a query each now come back together.
    totals = customers.aggregate(
        customers=Count("id"),
        customers_today=Count("id", filter=Q(created_at__gte=today)),
        gifts=Count("id", filter=~Q(reward="")),
        repeat_faces=Count("id", filter=Q(repeat_of__isnull=False)),
        **{
            f"day{i}": Count("id", filter=Q(created_at__gte=d, created_at__lt=d + timedelta(days=1)))
            for i, d in enumerate(days)
        },
    )
    per_day = [{"date": d.date().isoformat(), "count": totals.pop(f"day{i}")} for i, d in enumerate(days)]
    steps = {
        "checked": Q(events__kind="checked"),
        "whatsapp_sent": Q(events__kind="whatsapp_sent"),
        "link_opened": Q(events__kind="link_opened"),
        "spun": Q(events__kind="spun"),
        "poster_saved": Q(events__kind="poster_saved"),
        "shared": Q(events__kind__in=CustomerEvent.SHARE_KINDS),
    }
    funnel = customers.aggregate(**{k: Count("id", filter=q, distinct=True) for k, q in steps.items()})
    rewards = (
        customers.exclude(reward="").values("reward").annotate(n=Count("id")).order_by("-n")
    )
    top = (
        customers.exclude(mirror_name="").values("mirror_name")
        .annotate(n=Count("id")).order_by("-n")[:5]
    )
    return {
        "funnel": funnel,
        "abandoned": _link_unsent(customers).count(),
        "shares": _platform_counts(customers, CustomerEvent.SHARE_KINDS),
        "share_opened": _platform_counts(customers, CustomerEvent.OPEN_KINDS),
        "posted": _platform_counts(customers, CustomerEvent.POSTED_KINDS),
        "rating": customers.aggregate(avg=Avg("rating"), n=Count("rating")),
        "reviews": list(
            customers.exclude(rating=None).order_by("-updated_at")
            .values("id", "name", "branch_name", "rating", "review")[:6]
        ),
        **totals,
        "per_day": per_day,
        "rewards": [{"id": r["reward"], "n": r["n"]} for r in rewards],
        "top_mirrors": [{"name": m["mirror_name"], "n": m["n"]} for m in top],
    }


@api_view(["GET"])
@permission_classes([IsAdminUser])
def rejections(request):
    """Refused checks still waiting: what was typed and what Django read."""
    return Response(CustomerEventSerializer(_failed_attempts()[:200], many=True, context={"ids": True}).data)


def _resolve(event, how, user):
    """Marks a refusal (and that number's earlier ones) as handled."""
    for e in CustomerEvent.objects.filter(kind="check_failed", phone=event.phone):
        e.detail = {**e.detail, "resolved": how, "resolved_by": user.get_username()}
        e.save(update_fields=["detail"])


@api_view(["POST"])
@permission_classes([IsAdminUser])
def approve_rejection(request, pk):
    """An admin checked the refused purchase by hand: file it with the
    corrected details and return the spin link to send."""
    event = CustomerEvent.objects.filter(pk=pk, kind="check_failed").first()
    if event is None:
        return Response({"detail": "This rejection no longer exists."}, status=404)
    ser = ApprovalSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    data = ser.validated_data
    data["ocr_text"] = event.detail.get("ocr_text", "")
    customer = _save_purchase(data, _branch(data["branch"]), approved_by=request.user.get_username())
    _resolve(event, "approved", request.user)
    return Response({"phone": customer.phone, "link": spin_link(customer.spin_token)})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def dismiss_rejection(request, pk):
    event = CustomerEvent.objects.filter(pk=pk, kind="check_failed").first()
    if event is None:
        return Response({"detail": "This rejection no longer exists."}, status=404)
    _resolve(event, "dismissed", request.user)
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([IsAdminUser])
def server_status(request):
    """The VPS's CPU, memory, storage and network, and who is online now."""
    from .server import snapshot

    return Response({**snapshot(), "live": live_visitors()})


@api_view(["GET"])
@permission_classes([IsAdminUser])
def database_backup(request):
    """The whole database (every table and row) as a .sql file, streamed."""
    import os
    import subprocess

    from django.db import connection

    db = settings.DATABASES["default"]
    name = f"sky-database-{timezone.localtime():%Y%m%d-%H%M}.sql"
    if connection.vendor == "mysql":
        proc = subprocess.Popen(
            ["mysqldump", "--single-transaction", "--quick", "--no-tablespaces",
             "--routines", "-h", db["HOST"] or "127.0.0.1", "-P", str(db["PORT"] or 3306),
             "-u", db["USER"], db["NAME"]],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env={**os.environ, "MYSQL_PWD": db["PASSWORD"]},  # never on the command line
        )

        def chunks():
            try:
                yield from iter(lambda: proc.stdout.read(64 * 1024), b"")
            finally:
                proc.stdout.close()
                proc.wait()

        body = chunks()
    else:
        connection.ensure_connection()
        body = (line + "\n" for line in connection.connection.iterdump())
    response = StreamingHttpResponse(body, content_type="application/sql")
    response["Content-Disposition"] = f'attachment; filename="{name}"'
    response["Cache-Control"] = "no-store"
    return response


@api_view(["GET"])
@permission_classes([IsAdminUser])
def stats(request):
    data = _customer_stats(Customer.objects.all())
    data.update(
        mirrors=Mirror.objects.count(),
        active_mirrors=Mirror.objects.filter(is_active=True).count(),
        branches=Branch.objects.count(),
        branch_sales=[
            {"id": b.pk, "name": b.name, "value": b.value, "n": b.n}
            for b in Branch.objects.annotate(
                value=Sum("customers__bill_value"), n=Count("customers")
            ).filter(value__gt=0).order_by("-value")[:8]
        ],
        live=live_count(),
        failed_checks=CustomerEvent.objects.filter(kind="check_failed").count(),
        abandoned=_link_unsent(Customer.objects.all()).count() + len(_failed_attempts()),
        top_branches=list(
            Branch.objects.annotate(n=Count("customers")).order_by("-n", "name").values("id", "name", "n")
        ),
    )
    return Response(data)


class SpinItemViewSet(viewsets.ModelViewSet):
    """Wheel gifts and the bill range each one is for."""

    serializer_class = SpinItemSerializer
    permission_classes = [IsAdminUser]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    queryset = SpinItem.objects.all()


class BranchViewSet(viewsets.ModelViewSet):
    """Stores: add, edit, delete; each has a studio link and a QR code.
    Deleting a branch keeps its customers (their records keep the name)."""

    serializer_class = BranchSerializer
    permission_classes = [IsAdminUser]

    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        return Branch.objects.annotate(
            customer_count=Count("customers"), sales=Sum("customers__bill_value")
        ).order_by("-customer_count", "name")

    def get_serializer_context(self):
        """How far each branch's customers have got, for the cards' bars."""
        steps = {"sent": ["whatsapp_sent"], "opened": ["link_opened"], "spun": ["spun"],
                 "posters": ["poster_saved"], "shared": CustomerEvent.SHARE_KINDS}
        journey = {}
        for step, kinds in steps.items():
            rows = (
                CustomerEvent.objects.filter(kind__in=kinds, customer__branch__isnull=False)
                .values("customer__branch").annotate(n=Count("customer", distinct=True))
            )
            for row in rows:
                journey.setdefault(row["customer__branch"], {})[step] = row["n"]
        return {**super().get_serializer_context(), "journey": journey}

    @action(detail=True, methods=["get"])
    def stats(self, request, pk=None):
        branch = self.get_object()
        return Response(_customer_stats(Customer.objects.filter(branch=branch)))

    @action(detail=True, methods=["get"])
    def qr(self, request, pk=None):
        """PNG QR code of the branch link; ?download=1 saves it as a file."""
        from io import BytesIO

        import qrcode
        from django.http import HttpResponse

        branch = self.get_object()
        code = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=3)
        code.add_data(branch_link(branch))
        code.make(fit=True)
        out = BytesIO()
        code.make_image(fill_color="#17120d", back_color="white").save(out, format="PNG")
        response = HttpResponse(out.getvalue(), content_type="image/png")
        response["Cache-Control"] = "private, no-store"
        if request.query_params.get("download"):
            response["Content-Disposition"] = f'attachment; filename="SKY-{branch.slug}-QR.png"'
        return response


class PublicBranch(APIView):
    """Branch name for the studio, from its link (?branch=<slug>)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [MirrorPollThrottle]

    def get(self, request, slug):
        branch = Branch.objects.filter(slug=slug, is_active=True).first()
        if branch is None:
            return Response({"detail": INACTIVE_BRANCH}, status=status.HTTP_404_NOT_FOUND)
        return Response(PublicBranchSerializer(branch).data)


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
