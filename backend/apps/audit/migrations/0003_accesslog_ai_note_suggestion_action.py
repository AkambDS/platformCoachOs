from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('audit', '0002_accesslog_more_actions'),
    ]

    operations = [
        migrations.AlterField(
            model_name='accesslog',
            name='action',
            field=models.CharField(choices=[('viewed_notes', 'Viewed Notes'), ('created_note', 'Created Note'), ('updated_note', 'Updated Note'), ('deleted_note', 'Deleted Note'), ('requested_ai_note_suggestion', 'Requested AI Note Suggestion'), ('viewed_assessments', 'Viewed Assessments'), ('downloaded_file', 'Downloaded File'), ('uploaded_file', 'Uploaded File'), ('deleted_file', 'Deleted File'), ('viewed_goals', 'Viewed Goals'), ('viewed_feedback', 'Viewed Feedback'), ('created_client', 'Created Client'), ('updated_client', 'Updated Client'), ('deleted_client', 'Deleted Client'), ('changed_password', 'Changed Password'), ('invited_team_member', 'Invited Team Member'), ('updated_team_member', 'Updated Team Member'), ('removed_team_member', 'Removed Team Member')], max_length=30),
        ),
    ]
