from django.db import migrations

# Unifies the built-in "Archive" status color with "Inactive"'s grey (#b8b2ab) — they were
# seeded with two subtly different tones (#c8c4bc vs #b8b2ab). Only touches rows still at
# the original seeded default: a workspace that already customized "Archive"'s color is
# left untouched.
OLD_ARCHIVE_COLOR = "#c8c4bc"
NEW_GREY = "#b8b2ab"


def unify_grey(apps, schema_editor):
    ClientStatusConfig = apps.get_model("clients", "ClientStatusConfig")
    ClientStatusConfig.objects.filter(
        is_builtin=True, label="Archive", color=OLD_ARCHIVE_COLOR,
    ).update(color=NEW_GREY)


def reverse(apps, schema_editor):
    ClientStatusConfig = apps.get_model("clients", "ClientStatusConfig")
    ClientStatusConfig.objects.filter(
        is_builtin=True, label="Archive", color=NEW_GREY,
    ).update(color=OLD_ARCHIVE_COLOR)


class Migration(migrations.Migration):

    dependencies = [
        ("clients", "0019_client_email_2_client_phone_2_client_phone_2_ext_and_more"),
    ]

    operations = [
        migrations.RunPython(unify_grey, reverse),
    ]
