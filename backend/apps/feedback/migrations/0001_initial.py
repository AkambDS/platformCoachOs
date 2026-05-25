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
            name="FeedbackTicket",
            fields=[
                ("id",              models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("title",           models.CharField(max_length=200)),
                ("description",     models.TextField()),
                ("category",        models.CharField(max_length=20, default="general",
                                        choices=[("bug","Bug"),("feature","Feature Request"),
                                                 ("ui","UI / UX"),("performance","Performance"),
                                                 ("general","General")])),
                ("priority",        models.CharField(max_length=20, default="medium",
                                        choices=[("low","Low"),("medium","Medium"),
                                                 ("high","High"),("critical","Critical")])),
                ("status",          models.CharField(max_length=20, default="new",
                                        choices=[("new","New"),("reviewing","Reviewing"),
                                                 ("in_progress","In Progress"),
                                                 ("resolved","Resolved"),("closed","Closed")])),
                ("page_url",        models.CharField(max_length=500, blank=True)),
                ("screenshot_data", models.TextField(blank=True)),
                ("created_at",      models.DateTimeField(auto_now_add=True)),
                ("updated_at",      models.DateTimeField(auto_now=True)),
                ("closed_at",       models.DateTimeField(null=True, blank=True)),
                ("workspace",       models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="feedback_feedbackticket_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("submitted_by",    models.ForeignKey(
                    on_delete=django.db.models.deletion.SET_NULL, null=True,
                    related_name="feedback_submitted", to="accounts.user",
                )),
            ],
            options={"db_table": "feedback_tickets", "ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="FeedbackComment",
            fields=[
                ("id",         models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("text",       models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("workspace",  models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="feedback_feedbackcomment_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("ticket",     models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="comments", to="feedback.feedbackticket",
                )),
                ("created_by", models.ForeignKey(
                    on_delete=django.db.models.deletion.SET_NULL, null=True,
                    related_name="feedback_comments", to="accounts.user",
                )),
            ],
            options={"db_table": "feedback_comments", "ordering": ["created_at"]},
        ),
    ]
