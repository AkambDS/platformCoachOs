from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"

    def ready(self):
        from django.db.models.signals import post_migrate
        post_migrate.connect(_apply_rls, sender=self)


def _apply_rls(sender, **kwargs):
    """
    Apply PostgreSQL RLS policies after all migrations complete.
    Uses IF NOT EXISTS so it's safe to run multiple times.
    """
    from django.db import connection

    RLS_TABLES = [
        "clients_client",
        "clients_assessment",
        "clients_clientgoal",
        "clients_commitment",
        "clients_goalprogress",
        "activities_activity",
        "pipeline_deal",
        "pipeline_stagehistory",
        "invoicing_invoice",
        "invoicing_payment",
        "library_folder",
        "library_item",
    ]

    with connection.cursor() as cursor:
        for table in RLS_TABLES:
            # Check table exists before applying RLS
            cursor.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_name = %s
                )
            """, [table])
            exists = cursor.fetchone()[0]
            if not exists:
                continue

            # Enable RLS
            cursor.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

            # Drop and recreate policy (idempotent)
            cursor.execute(f"""
                DO $$ BEGIN
                    DROP POLICY IF EXISTS tenant_isolation ON {table};
                    CREATE POLICY tenant_isolation ON {table}
                      USING (workspace_id = current_setting('app.workspace_id', TRUE)::uuid);
                END $$
            """)

        # Portal isolation on clientgoal — checks both workspace AND client
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'clients_clientgoal'
            )
        """)
        if cursor.fetchone()[0]:
            cursor.execute("""
                DO $$ BEGIN
                    DROP POLICY IF EXISTS portal_isolation ON clients_clientgoal;
                    CREATE POLICY portal_isolation ON clients_clientgoal
                      USING (
                        workspace_id = current_setting('app.workspace_id', TRUE)::uuid
                        AND (
                          current_setting('app.client_id', TRUE) IS NULL
                          OR client_id::text = current_setting('app.client_id', TRUE)
                        )
                      );
                END $$
            """)

        # Audit log — revoke DELETE from app user (safe if role doesn't exist)
        cursor.execute("""
            DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coachos') THEN
                REVOKE DELETE ON audit_log FROM coachos;
              END IF;
            END $$
        """)
