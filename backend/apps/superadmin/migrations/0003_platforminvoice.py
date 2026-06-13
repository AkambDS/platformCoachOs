from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("superadmin", "0002_banner_created_at"),
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="PlatformInvoice",
            fields=[
                ("id", models.AutoField(primary_key=True, serialize=False)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="platform_invoices", to="accounts.workspace")),
                ("amount", models.DecimalField(decimal_places=2, max_digits=10)),
                ("plan", models.CharField(max_length=20)),
                ("period_start", models.DateField()),
                ("period_end", models.DateField()),
                ("notes", models.TextField(blank=True)),
                ("status", models.CharField(
                    choices=[("draft", "Draft"), ("sent", "Sent"), ("paid", "Paid"), ("overdue", "Overdue")],
                    default="draft", max_length=10,
                )),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "superadmin_platforminvoice", "ordering": ["-created_at"]},
        ),
    ]
