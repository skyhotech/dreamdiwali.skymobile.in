from django.db import migrations

# Store (CUG) numbers from SKYWORLD BRANCH.xlsx. Each invoice prints its
# store's number, so the manager form can tell which branch a bill is from.
# Numbers already set in the admin are kept.
STORE_NUMBERS = {
    "arcot": "9361373727", "arni-1": "8754750009", "arni-2": "9361684885",
    "arni-3": "6383941914", "avalurpet": "9123525312", "chengam": "9655895592",
    "chetpet": "8754740009", "dharmapuri": "9080349183", "gudiyatham": "7845082979",
    "pallikonda": "9790102001", "kannamangalam": "8489492300", "krishnagiri": "7695866652",
    "polur": "9361358553", "puducherry": "8778829472", "ranipet-1": "9025431811",
    "ranipet-2": "8667670649", "sholinghur": "9344799353", "thirupattur-1": "8778333903",
    "thirupattur-2": "8248205223", "thiruthani": "9043451343",
    "thiruvannamalai-1": "8754905008", "thiruvannamalai-2": "9025244200",
    "thiruvannamalai-3": "7904741512", "thiruvannamalai-4": "7010141694",
    "uthiramerur": "8925778780", "vellore-1": "8754740006", "vellore-2": "8754780007",
    "vellore-3": "8754740002", "vellore-4": "8754966941", "vellore-5": "9361553446",
    "walajapet": "9150363646",
}


def seed(apps, schema_editor):
    Branch = apps.get_model("mirrors", "Branch")
    for slug, phone in STORE_NUMBERS.items():
        Branch.objects.filter(slug=slug, phone="").update(phone=phone)


class Migration(migrations.Migration):

    dependencies = [
        ("mirrors", "0015_customer_terms"),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
