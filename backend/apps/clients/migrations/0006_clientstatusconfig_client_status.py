from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
        ('clients', '0005_alter_clientnote_workspace'),
    ]

    operations = [
        migrations.CreateModel(
            name='ClientStatusConfig',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('label', models.CharField(max_length=50)),
                ('color', models.CharField(default='#8c8279', max_length=7)),
                ('is_builtin', models.BooleanField(default=False)),
                ('sort_order', models.IntegerField(default=0)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='client_status_configs', to='accounts.workspace')),
            ],
            options={
                'db_table': 'clients_statusconfig',
                'ordering': ['sort_order', 'label'],
                'unique_together': {('workspace', 'label')},
            },
        ),
        migrations.AddField(
            model_name='client',
            name='status',
            field=models.CharField(blank=True, default='Lead', max_length=50),
        ),
    ]
