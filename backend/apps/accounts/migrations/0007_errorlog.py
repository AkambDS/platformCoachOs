import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0006_user_role_platform_admin"),
    ]

    operations = [
        migrations.CreateModel(
            name="ErrorLog",
            fields=[
                ("id",         models.BigAutoField(primary_key=True)),
                ("severity",   models.CharField(max_length=20, default="error",
                                   choices=[("warning","Warning"),("error","Error"),("critical","Critical")])),
                ("source",     models.CharField(max_length=20, default="api",
                                   choices=[("api","API"),("celery","Celery")])),
                ("error_type", models.CharField(max_length=200, blank=True)),
                ("message",    models.TextField()),
                ("traceback",  models.TextField(blank=True)),
                ("endpoint",   models.CharField(max_length=500, blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("workspace",  models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, null=True, blank=True,
                    to="accounts.workspace",
                )),
                ("user",       models.ForeignKey(
                    on_delete=django.db.models.deletion.SET_NULL, null=True, blank=True,
                    to="accounts.user",
                )),
            ],
            options={"db_table": "error_log", "ordering": ["-created_at"]},
        ),
    ]
