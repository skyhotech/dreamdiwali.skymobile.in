from django.contrib.auth import views as auth_views
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("mirrors", views.MirrorViewSet, basename="admin-mirror")
router.register("customers", views.CustomerViewSet, basename="admin-customer")
router.register("branches", views.BranchViewSet, basename="admin-branch")
router.register("spin-items", views.SpinItemViewSet, basename="admin-spin-item")

api_urlpatterns = [
    path("mirrors/", views.PublicMirrorList.as_view(), name="public-mirrors"),
    path("mirrors/stream/", views.mirror_stream, name="public-mirrors-stream"),
    path("mirrors/version/", views.PublicMirrorVersion.as_view(), name="public-mirrors-version"),
    path("customers/", views.CustomerUpload.as_view(), name="customer-upload"),
    path("customers/link/<str:token>/", views.CustomerLink.as_view(), name="customer-link"),
    path("customers/spin/", views.CustomerSpin.as_view(), name="customer-spin"),
    path("manager/branches/", views.ManagerBranches.as_view(), name="manager-branches"),
    path("customers/terms/", views.CustomerTerms.as_view(), name="customer-terms"),
    path("customers/review/", views.CustomerReview.as_view(), name="customer-review"),
    path("live/", views.LivePing.as_view(), name="live-ping"),
    path("client-error/", views.ClientError.as_view(), name="client-error"),
    path("customers/whatsapp-proof/", views.CustomerWhatsappProof.as_view(), name="customer-whatsapp-proof"),
    path("admin/customers/<int:pk>/whatsapp-verify/", views.verify_whatsapp, name="admin-whatsapp-verify"),
    path("customers/profile/", views.CustomerProfile.as_view(), name="customer-profile"),
    path("customers/event/", views.CustomerEventView.as_view(), name="customer-event"),
    path("manager/sent/", views.ManagerSent.as_view(), name="manager-sent"),
    path("manager/scan/", views.ManagerScan.as_view(), name="manager-scan"),
    path("manager/check/", views.ManagerCheck.as_view(), name="manager-check"),
    path("branches/<slug:slug>/", views.PublicBranch.as_view(), name="public-branch"),
    path("admin/stats/", views.stats, name="admin-stats"),
    path("admin/server/", views.server_status, name="admin-server"),
    path("admin/rejections/", views.rejections, name="admin-rejections"),
    path("admin/sharers/<str:platform>/", views.sharers, name="admin-sharers"),
    path("admin/rejections/<int:pk>/approve/", views.approve_rejection, name="admin-rejection-approve"),
    path("admin/rejections/<int:pk>/dismiss/", views.dismiss_rejection, name="admin-rejection-dismiss"),
    path("admin/backup.sql", views.database_backup, name="admin-backup"),
    path("admin/", include(router.urls)),
]

dashboard_urlpatterns = [
    path("", views.dashboard, name="mirror-dashboard"),
    path("login/", views.LockoutLoginView.as_view(), name="mirror-login"),
    path("logout/", auth_views.LogoutView.as_view(next_page="mirror-login"), name="mirror-logout"),
]
