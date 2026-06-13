from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("superadmin", "0004_platforminvoice_line_items"),
    ]

    operations = [
        migrations.AddField(
            model_name="platforminvoice",
            name="is_recurring",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="platforminvoice",
            name="recurrence_months",
            field=models.PositiveSmallIntegerField(blank=True, default=1, null=True),
        ),
        migrations.CreateModel(
            name="PlatformPayment",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("invoice", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="payments", to="superadmin.platforminvoice")),
                ("amount", models.DecimalField(decimal_places=2, max_digits=10)),
                ("payment_date", models.DateField()),
                ("method", models.CharField(
                    choices=[("bank_transfer", "Bank Transfer"), ("cash", "Cash"), ("card", "Card"), ("other", "Other")],
                    default="bank_transfer", max_length=30,
                )),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"db_table": "superadmin_platformpayment", "ordering": ["-payment_date"]},
        ),
    ]
