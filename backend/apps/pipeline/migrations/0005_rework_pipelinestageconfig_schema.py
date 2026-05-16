from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pipeline', '0004_alter_pipelinestageconfig_workspace'),
    ]

    operations = [
        # Drop old unique_together on (workspace, stage)
        migrations.AlterUniqueTogether(
            name='pipelinestageconfig',
            unique_together=set(),
        ),
        # Wipe any junk rows created by the old schema before restructuring
        migrations.RunSQL(
            "DELETE FROM pipeline_stageconfigconfig;",
            reverse_sql=migrations.RunSQL.noop,
        ),
        # Remove old 'stage' choices field
        migrations.RemoveField(
            model_name='pipelinestageconfig',
            name='stage',
        ),
        # Make follow_up_days nullable (was default=14, required)
        migrations.AlterField(
            model_name='pipelinestageconfig',
            name='follow_up_days',
            field=models.PositiveIntegerField(null=True, blank=True),
        ),
        # Add new fields
        migrations.AddField(
            model_name='pipelinestageconfig',
            name='slug',
            field=models.CharField(max_length=50, default=''),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='pipelinestageconfig',
            name='label',
            field=models.CharField(max_length=50, default=''),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='pipelinestageconfig',
            name='color',
            field=models.CharField(max_length=7, default='#1e3a5f'),
        ),
        migrations.AddField(
            model_name='pipelinestageconfig',
            name='order',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='pipelinestageconfig',
            name='is_builtin',
            field=models.BooleanField(default=False),
        ),
        # New unique_together on (workspace, slug)
        migrations.AlterUniqueTogether(
            name='pipelinestageconfig',
            unique_together={('workspace', 'slug')},
        ),
        migrations.AlterModelOptions(
            name='pipelinestageconfig',
            options={'ordering': ['order']},
        ),
    ]
