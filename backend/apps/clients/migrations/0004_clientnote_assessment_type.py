from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('clients', '0003_alter_assessment_assessment_type_alter_assessment_id_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ClientNote',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('text', models.TextField()),
                ('note_type', models.CharField(
                    choices=[
                        ('general', 'General'),
                        ('session', 'Session Note'),
                        ('observation', 'Observation'),
                        ('commitment', 'Commitment'),
                    ],
                    default='general', max_length=20,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('client', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='client_notes', to='clients.client',
                )),
                ('created_by', models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name='+', to=settings.AUTH_USER_MODEL,
                )),
                ('workspace', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='+',
                    to='accounts.workspace',
                )),
            ],
            options={'db_table': 'clients_clientnote', 'ordering': ['-created_at']},
        ),
        migrations.AlterField(
            model_name='assessment',
            name='assessment_type',
            field=models.CharField(
                choices=[
                    ('contract', 'Contract'),
                    ('disc', 'DISC Assessment'),
                    ('motivators', 'Motivators'),
                    ('behavioral', 'Behavioral Assessment'),
                    ('other', 'Other'),
                ],
                max_length=20,
            ),
        ),
    ]
