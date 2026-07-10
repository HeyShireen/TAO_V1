-- Un role applicatif ne doit pas pouvoir activer le scope de migration en
-- positionnant simplement une variable de session PostgreSQL.
CREATE OR REPLACE FUNCTION public.aolink_migration_scope_allowed()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT public.aolink_setting_true('app.migration_scope')
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
       WHERE n.nspname = 'public'
         AND c.relname = 'tenants'
         AND r.rolname = current_user
     )
$$;

CREATE OR REPLACE FUNCTION public.aolink_tenant_allowed(row_tenant_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT row_tenant_id = public.aolink_current_tenant_id()
      OR public.aolink_migration_scope_allowed()
$$;

DROP POLICY IF EXISTS tenant_catalog_read ON public.tenants;
CREATE POLICY tenant_catalog_read ON public.tenants FOR SELECT
USING (
  id = public.aolink_current_tenant_id()
  OR public.aolink_setting_true('app.auth_scope')
  OR public.aolink_setting_true('app.platform_scope')
  OR public.aolink_migration_scope_allowed()
);

DROP POLICY IF EXISTS tenant_catalog_write ON public.tenants;
CREATE POLICY tenant_catalog_write ON public.tenants FOR ALL
USING (public.aolink_setting_true('app.platform_scope') OR public.aolink_migration_scope_allowed())
WITH CHECK (public.aolink_setting_true('app.platform_scope') OR public.aolink_migration_scope_allowed());

DROP POLICY IF EXISTS platform_audit_scope ON public.platform_audit_events;
CREATE POLICY platform_audit_scope ON public.platform_audit_events
USING (public.aolink_setting_true('app.platform_scope') OR public.aolink_migration_scope_allowed())
WITH CHECK (public.aolink_setting_true('app.platform_scope') OR public.aolink_migration_scope_allowed());
