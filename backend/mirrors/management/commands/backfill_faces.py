from django.core.management.base import BaseCommand

from mirrors.faces import MODEL, fingerprint
from mirrors.models import Customer


class Command(BaseCommand):
    help = "Compute server-side face fingerprints for prize winners from their stored selfies."

    def handle(self, *args, **options):
        done = skipped = 0
        for c in Customer.objects.exclude(reward="").iterator():
            if isinstance(c.face, dict) and c.face.get("model") == MODEL:
                continue
            photo = c.selfie or c.poster
            if not photo:
                skipped += 1
                continue
            try:
                with photo.open("rb") as fh:
                    face = fingerprint(fh)
            except (FileNotFoundError, OSError):
                skipped += 1
                continue
            if face is None:
                skipped += 1
                continue
            Customer.objects.filter(pk=c.pk).update(face=face)
            done += 1
        self.stdout.write(self.style.SUCCESS(f"fingerprinted {done}, skipped {skipped}"))
