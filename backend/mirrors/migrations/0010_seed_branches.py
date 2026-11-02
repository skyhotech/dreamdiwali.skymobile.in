from django.db import migrations
from django.utils.text import slugify

# From SKYWORLD BRANCH.xlsx. Existing branches are left as they are.
BRANCHES = [
    "ARCOT", "ARNI-1", "ARNI-2", "ARNI-3", "AVALURPET", "CHENGAM", "CHETPET",
    "DHARMAPURI", "GUDIYATHAM", "PALLIKONDA", "KANNAMANGALAM", "KRISHNAGIRI",
    "POLUR", "PUDUCHERRY", "RANIPET-1", "RANIPET-2", "SHOLINGHUR",
    "THIRUPATTUR-1", "THIRUPATTUR-2", "THIRUTHANI", "THIRUVANNAMALAI-1",
    "THIRUVANNAMALAI-2", "THIRUVANNAMALAI-3", "THIRUVANNAMALAI-4",
    "UTHIRAMERUR", "VELLORE-1", "VELLORE-2", "VELLORE-3", "VELLORE-4",
    "VELLORE-5", "WALAJAPET",
]


def seed(apps, schema_editor):
    Branch = apps.get_model("mirrors", "Branch")
    for name in BRANCHES:
        Branch.objects.get_or_create(slug=slugify(name), defaults={"name": name})


class Migration(migrations.Migration):

    dependencies = [
        ("mirrors", "0009_customer_serial"),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
