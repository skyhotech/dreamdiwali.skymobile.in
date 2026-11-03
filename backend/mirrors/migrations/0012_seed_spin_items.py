from django.db import migrations

# The six gifts the wheel started with; pictures ship with the studio.
GIFTS = [
    ("neckband", "Neck Band"), ("mini-speaker", "Mini Speaker"),
    ("smart-watch", "Smart Watch"), ("wired-headphone", "Wired Headphone"),
    ("mobile-stand", "Mobile Stand"), ("power-bank", "Power Bank"),
]


def seed(apps, schema_editor):
    SpinItem = apps.get_model("mirrors", "SpinItem")
    for slug, name in GIFTS:
        SpinItem.objects.get_or_create(slug=slug, defaults={"name": name})


class Migration(migrations.Migration):

    dependencies = [
        ("mirrors", "0011_spin_items"),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
