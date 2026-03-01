import uuid
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="KnowledgeFolder",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("name", models.CharField(max_length=200)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_knowledgefolder_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("parent", models.ForeignKey(
                    null=True, blank=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="children", to="library.knowledgefolder",
                )),
            ],
            options={"db_table": "library_folder", "ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="KnowledgeItem",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("content_type", models.CharField(max_length=20)),
                ("title", models.CharField(max_length=300)),
                ("description", models.TextField(blank=True)),
                ("tags", models.JSONField(default=list)),
                ("visibility", models.CharField(max_length=20, default="internal")),
                ("s3_key", models.CharField(max_length=500, blank=True)),
                ("file_name", models.CharField(max_length=255, blank=True)),
                ("url", models.URLField(blank=True)),
                ("rich_text", models.TextField(blank=True)),
                ("version", models.PositiveSmallIntegerField(default=1)),
                ("previous_versions", models.JSONField(default=list)),
                ("view_count", models.PositiveIntegerField(default=0)),
                ("download_count", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_knowledgeitem_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("folder", models.ForeignKey(
                    null=True, blank=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="items", to="library.knowledgefolder",
                )),
                ("uploaded_by", models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    to="accounts.user",
                )),
            ],
            options={"db_table": "library_item", "ordering": ["-created_at"]},
        ),
    ]
