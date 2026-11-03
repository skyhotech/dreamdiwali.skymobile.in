import json

from django.http import JsonResponse

from .models import Customer


class SpinOnceMiddleware:
    """A spin link spins once. Any later spin on it stops here with the prize
    already won and where the customer goes next; the view is never reached."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "POST" and request.path == "/api/customers/spin/":
            try:
                token = json.loads(request.body or b"{}").get("token")
            except (ValueError, AttributeError):
                token = None
            customer = Customer.objects.filter(spin_token=token).first() if token else None
            if customer and customer.reward:
                return JsonResponse({"reward": customer.reward, "next": customer.next_step})
        return self.get_response(request)
