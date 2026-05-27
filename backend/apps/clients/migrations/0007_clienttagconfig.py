from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
        ('clients', '0006_clientstatusconfig_client_status'),
    ]

    operations = [
        migrations.CreateModel(
            name='ClientTagConfig',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=50)),
                ('color', models.CharField(default='#2d6a9f', max_length=7)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='client_tag_configs', to='accounts.workspace')),
            ],
            options={
                'db_table': 'clients_tagconfig',
                'ordering': ['name'],
                'unique_together': {('workspace', 'name')},
            },
        ),
    ]
