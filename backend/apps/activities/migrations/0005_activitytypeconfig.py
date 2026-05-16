from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('activities', '0004_activity_notification_timestamps'),
        ('accounts', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='ActivityTypeConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='%(class)ss', to='accounts.workspace')),
                ('name', models.CharField(max_length=50)),
                ('color', models.CharField(default='#1a1714', max_length=7)),
                ('is_active', models.BooleanField(default=True)),
                ('default_duration_mins', models.PositiveIntegerField(default=60)),
                ('is_builtin', models.BooleanField(default=False)),
                ('sort_order', models.PositiveIntegerField(default=0)),
            ],
            options={
                'db_table': 'activities_activitytypeconfig',
                'ordering': ['sort_order', 'name'],
                'unique_together': {('workspace', 'name')},
            },
        ),
    ]
