from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('pipeline', '0002_alter_deal_id_alter_deal_stage_alter_deal_workspace_and_more'),
        ('accounts', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='deal',
            name='pipeline_alert_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name='PipelineStageConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='%(class)ss', to='accounts.workspace')),
                ('stage', models.CharField(choices=[('lead_new', 'Lead – New'), ('discovery_scheduled', 'Discovery Scheduled'), ('discovery_completed', 'Discovery Completed'), ('proposal_sent', 'Proposal Sent'), ('verbal_yes', 'Verbal Yes'), ('active_client', 'Active Client'), ('on_hold', 'On Hold'), ('closed_lost', 'Closed – Lost')], max_length=30)),
                ('follow_up_days', models.PositiveIntegerField(default=14)),
                ('notify_owner', models.BooleanField(default=True)),
                ('notify_client', models.BooleanField(default=False)),
            ],
            options={
                'db_table': 'pipeline_stageconfigconfig',
                'unique_together': {('workspace', 'stage')},
            },
        ),
    ]
