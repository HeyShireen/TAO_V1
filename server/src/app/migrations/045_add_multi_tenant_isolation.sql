-- Cloisonnement SaaS initial : DMX + DEMO.
-- Cette migration doit etre executee application arretee et apres sauvegarde.

CREATE TABLE IF NOT EXISTS public.tenants (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('customer', 'demo')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.tenants (slug, name, type)
VALUES ('dmx', 'DMX', 'customer'), ('demo', 'DEMO', 'demo')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type;

CREATE TABLE IF NOT EXISTS public.tenant_invitations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('tenant_admin', 'responsable', 'visionneur', 'entreprise')),
  company_id BIGINT REFERENCES public.companies(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_invitations_pending_email_idx
  ON public.tenant_invitations (lower(email)) WHERE accepted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.platform_audit_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  tenant_id BIGINT REFERENCES public.tenants(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Toutes les tables contenant des donnees client portent directement le tenant.
DO $$
DECLARE
  table_name TEXT;
  tenant_tables TEXT[] := ARRAY[
    'users', 'projects', 'companies', 'lots', 'rounds', 'round_lots',
    'items', 'moe_items', 'moe', 'offers', 'lot_companies',
    'project_shares', 'email_verifications', 'access_requests',
    'password_resets', 'refresh_tokens', 'suspicious_token_attempts',
    'project_question_config', 'lot_threshold_config', 'lot_question_config',
    'generated_questions', 'question_sheets', 'round_offers',
    'options', 'option_items', 'option_item_moe', 'option_item_offers',
    'question_sheet_sends'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES public.tenants(id)',
        table_name
      );
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.refresh_tokens ADD COLUMN IF NOT EXISTS active_tenant_id BIGINT REFERENCES public.tenants(id);

-- Affectation des comptes et projets.
UPDATE public.users
SET tenant_id = CASE
  WHEN lower(email) = lower(COALESCE(NULLIF(current_setting('app.demo_email', true), ''), 'demo@ao-link.fr'))
    THEN (SELECT id FROM public.tenants WHERE slug = 'demo')
  ELSE (SELECT id FROM public.tenants WHERE slug = 'dmx')
END
WHERE tenant_id IS NULL;

UPDATE public.users SET role = 'tenant_admin' WHERE role = 'admin';
UPDATE public.users
SET role = 'platform_admin', tenant_id = (SELECT id FROM public.tenants WHERE slug = 'dmx')
WHERE lower(email) = lower(COALESCE(NULLIF(current_setting('app.platform_admin_email', true), ''), 'alban.michaud65@gmail.com'));
UPDATE public.users
SET role = 'responsable', tenant_id = (SELECT id FROM public.tenants WHERE slug = 'demo')
WHERE lower(email) = lower(COALESCE(NULLIF(current_setting('app.demo_email', true), ''), 'demo@ao-link.fr'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users)
     AND NOT EXISTS (
       SELECT 1 FROM public.users
       WHERE lower(email) = lower(COALESCE(NULLIF(current_setting('app.platform_admin_email', true), ''), 'alban.michaud65@gmail.com'))
     ) THEN
    RAISE EXCEPTION 'Compte platform admin introuvable: %',
      COALESCE(NULLIF(current_setting('app.platform_admin_email', true), ''), 'alban.michaud65@gmail.com');
  END IF;
END $$;

UPDATE public.projects
SET tenant_id = CASE WHEN COALESCE(is_demo, false)
  THEN (SELECT id FROM public.tenants WHERE slug = 'demo')
  ELSE (SELECT id FROM public.tenants WHERE slug = 'dmx') END
WHERE tenant_id IS NULL;

-- Le compte partage DEMO devient proprietaire des projets de demonstration.
UPDATE public.projects p
SET owner_id = u.id
FROM public.users u, public.tenants t
WHERE p.tenant_id = t.id AND t.slug = 'demo'
  AND lower(u.email) = lower(COALESCE(NULLIF(current_setting('app.demo_email', true), ''), 'demo@ao-link.fr'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.projects p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE t.slug = 'demo' AND p.owner_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Un projet DEMO ne peut pas etre rattache au compte DEMO';
  END IF;
END $$;

-- Retirer les anciennes unicites globales sur le nom des entreprises avant
-- de dupliquer celles qui sont utilisees dans DMX et DEMO.
DO $$
DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.companies'::regclass
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ~* '\(name\)'
  LOOP
    EXECUTE format('ALTER TABLE public.companies DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;
DROP INDEX IF EXISTS public.companies_name_lower_idx;

CREATE TEMP TABLE tenant_company_map (
  old_company_id BIGINT PRIMARY KEY,
  demo_company_id BIGINT NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  company_row RECORD;
  cloned_id BIGINT;
BEGIN
  FOR company_row IN
    SELECT c.*
    FROM public.companies c
    WHERE EXISTS (
      SELECT 1 FROM public.lot_companies lc
      JOIN public.lots l ON l.id = lc.lot_id
      JOIN public.projects p ON p.id = l.project_id
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE lc.company_id = c.id AND t.slug = 'dmx'
    )
    AND EXISTS (
      SELECT 1 FROM public.lot_companies lc
      JOIN public.lots l ON l.id = lc.lot_id
      JOIN public.projects p ON p.id = l.project_id
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE lc.company_id = c.id AND t.slug = 'demo'
    )
  LOOP
    INSERT INTO public.companies (name, color, email, created_at, tenant_id)
    VALUES (
      company_row.name, company_row.color, company_row.email, company_row.created_at,
      (SELECT id FROM public.tenants WHERE slug = 'demo')
    ) RETURNING id INTO cloned_id;
    INSERT INTO tenant_company_map VALUES (company_row.id, cloned_id);
  END LOOP;
END $$;

UPDATE public.lot_companies lc SET company_id = m.demo_company_id
FROM tenant_company_map m, public.lots l, public.projects p, public.tenants t
WHERE lc.company_id = m.old_company_id AND l.id = lc.lot_id
  AND p.id = l.project_id AND t.id = p.tenant_id AND t.slug = 'demo';

UPDATE public.offers o SET company_id = m.demo_company_id
FROM tenant_company_map m, public.items i, public.lots l, public.projects p, public.tenants t
WHERE o.company_id = m.old_company_id AND i.id = o.item_id AND l.id = i.lot_id
  AND p.id = l.project_id AND t.id = p.tenant_id AND t.slug = 'demo';

UPDATE public.generated_questions q SET company_id = m.demo_company_id
FROM tenant_company_map m, public.lots l, public.projects p, public.tenants t
WHERE q.company_id = m.old_company_id AND l.id = q.lot_id
  AND p.id = l.project_id AND t.id = p.tenant_id AND t.slug = 'demo';

UPDATE public.option_item_offers oio SET company_id = m.demo_company_id
FROM tenant_company_map m, public.option_items oi, public.options o, public.lots l, public.projects p, public.tenants t
WHERE oio.company_id = m.old_company_id AND oi.id = oio.option_item_id AND o.id = oi.option_id
  AND l.id = o.lot_id AND p.id = l.project_id AND t.id = p.tenant_id AND t.slug = 'demo';

UPDATE public.items i SET source_company_id = m.demo_company_id
FROM tenant_company_map m, public.lots l, public.projects p, public.tenants t
WHERE i.source_company_id = m.old_company_id AND l.id = i.lot_id
  AND p.id = l.project_id AND t.id = p.tenant_id AND t.slug = 'demo';

DO $$
BEGIN
  IF to_regclass('public.question_sheets') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.question_sheets qs SET company_id = m.demo_company_id
      FROM tenant_company_map m, public.items i, public.lots l, public.projects p, public.tenants t
      WHERE qs.company_id = m.old_company_id AND i.id = qs.item_id AND l.id = i.lot_id
        AND p.id = l.project_id AND t.id = p.tenant_id AND t.slug = 'demo'
    $sql$;
  END IF;
  IF to_regclass('public.question_sheet_sends') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.question_sheet_sends qs SET company_id = m.demo_company_id
      FROM tenant_company_map m, public.lots l, public.projects p, public.tenants t
      WHERE qs.company_id = m.old_company_id AND l.id = qs.lot_id
        AND p.id = l.project_id AND t.id = p.tenant_id AND t.slug = 'demo'
    $sql$;
  END IF;
END $$;

UPDATE public.users u SET company_id = m.demo_company_id
FROM tenant_company_map m, public.tenants t
WHERE u.company_id = m.old_company_id AND u.tenant_id = t.id AND t.slug = 'demo';

UPDATE public.companies c
SET tenant_id = COALESCE(c.tenant_id, (
  SELECT p.tenant_id FROM public.lot_companies lc
  JOIN public.lots l ON l.id = lc.lot_id
  JOIN public.projects p ON p.id = l.project_id
  WHERE lc.company_id = c.id LIMIT 1
), (SELECT id FROM public.tenants WHERE slug = 'dmx'));

-- Propager le tenant depuis les racines vers toutes les tables descendantes.
UPDATE public.lots c SET tenant_id = p.tenant_id FROM public.projects p WHERE c.project_id = p.id;
UPDATE public.rounds c SET tenant_id = p.tenant_id FROM public.projects p WHERE c.project_id = p.id;
UPDATE public.round_lots c SET tenant_id = p.tenant_id FROM public.rounds p WHERE c.round_id = p.id;
UPDATE public.items c SET tenant_id = p.tenant_id FROM public.lots p WHERE c.lot_id = p.id;
UPDATE public.moe_items c SET tenant_id = p.tenant_id FROM public.items p WHERE c.item_id = p.id;
UPDATE public.moe c SET tenant_id = p.tenant_id FROM public.items p WHERE c.item_id = p.id;
UPDATE public.offers c SET tenant_id = p.tenant_id FROM public.items p WHERE c.item_id = p.id;
UPDATE public.lot_companies c SET tenant_id = p.tenant_id FROM public.lots p WHERE c.lot_id = p.id;
UPDATE public.project_shares c SET tenant_id = p.tenant_id FROM public.projects p WHERE c.project_id = p.id;
UPDATE public.email_verifications c SET tenant_id = p.tenant_id FROM public.users p WHERE c.user_id = p.id;
UPDATE public.access_requests c SET tenant_id = p.tenant_id FROM public.users p WHERE c.user_id = p.id;
UPDATE public.password_resets c SET tenant_id = p.tenant_id FROM public.users p WHERE c.user_id = p.id;
UPDATE public.refresh_tokens c SET tenant_id = p.tenant_id, active_tenant_id = COALESCE(c.active_tenant_id, p.tenant_id) FROM public.users p WHERE c.user_id = p.id;
UPDATE public.suspicious_token_attempts c SET tenant_id = p.tenant_id FROM public.users p WHERE c.user_id = p.id;
UPDATE public.project_question_config c SET tenant_id = p.tenant_id FROM public.projects p WHERE c.project_id = p.id;
UPDATE public.lot_threshold_config c SET tenant_id = p.tenant_id FROM public.lots p WHERE c.lot_id = p.id;
UPDATE public.lot_question_config c SET tenant_id = p.tenant_id FROM public.lots p WHERE c.lot_id = p.id;
UPDATE public.generated_questions c SET tenant_id = p.tenant_id FROM public.lots p WHERE c.lot_id = p.id;
UPDATE public.options c SET tenant_id = p.tenant_id FROM public.lots p WHERE c.lot_id = p.id;
UPDATE public.option_items c SET tenant_id = p.tenant_id FROM public.options p WHERE c.option_id = p.id;
UPDATE public.option_item_moe c SET tenant_id = p.tenant_id FROM public.option_items p WHERE c.option_item_id = p.id;
UPDATE public.option_item_offers c SET tenant_id = p.tenant_id FROM public.option_items p WHERE c.option_item_id = p.id;
UPDATE public.question_sheet_sends c SET tenant_id = p.tenant_id FROM public.lots p WHERE c.lot_id = p.id;

DO $$
BEGIN
  IF to_regclass('public.question_sheets') IS NOT NULL THEN
    EXECUTE 'UPDATE public.question_sheets c SET tenant_id = p.tenant_id FROM public.items p WHERE c.item_id = p.id';
  END IF;
  IF to_regclass('public.round_offers') IS NOT NULL THEN
    EXECUTE 'UPDATE public.round_offers c SET tenant_id = p.tenant_id FROM public.items p WHERE c.item_id = p.id';
  END IF;
END $$;

-- Refuser les relations utilisateur/projet qui traverseraient un tenant.
DO $$
DECLARE bad_links BIGINT;
BEGIN
  SELECT COUNT(*) INTO bad_links
  FROM public.project_shares s
  JOIN public.users u ON u.id = s.shared_with_user_id
  WHERE s.tenant_id <> u.tenant_id;
  IF bad_links > 0 THEN
    RAISE EXCEPTION '% partage(s) de projet traversent deux tenants', bad_links;
  END IF;

  SELECT COUNT(*) INTO bad_links
  FROM public.projects p JOIN public.users u ON u.id = p.owner_id
  WHERE p.tenant_id <> u.tenant_id;
  IF bad_links > 0 THEN
    RAISE EXCEPTION '% proprietaire(s) de projet appartiennent a un autre tenant', bad_links;
  END IF;
END $$;

-- Contexte RLS et remplissage automatique des nouvelles lignes.
CREATE OR REPLACE FUNCTION public.aolink_current_tenant_id()
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::BIGINT
$$;

CREATE OR REPLACE FUNCTION public.aolink_setting_true(setting_name TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN COALESCE(NULLIF(current_setting(setting_name, true), '')::BOOLEAN, false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $$;

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

CREATE OR REPLACE FUNCTION public.aolink_assign_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.aolink_current_tenant_id();
  END IF;
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Contexte tenant requis pour %', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  table_name TEXT;
  has_missing BOOLEAN;
  tenant_tables TEXT[] := ARRAY[
  'users', 'projects', 'companies', 'lots', 'rounds', 'round_lots', 'items',
  'moe_items', 'moe', 'offers', 'lot_companies', 'project_shares',
  'email_verifications', 'access_requests', 'password_resets', 'refresh_tokens',
  'suspicious_token_attempts', 'project_question_config', 'lot_threshold_config',
  'lot_question_config', 'generated_questions', 'question_sheets', 'round_offers',
  'options', 'option_items', 'option_item_moe', 'option_item_offers',
  'question_sheet_sends', 'tenant_invitations'
];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE tenant_id IS NULL)', table_name)
        INTO has_missing;
      IF has_missing THEN
        RAISE EXCEPTION 'tenant_id manquant dans %', table_name;
      END IF;
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', table_name);
      EXECUTE format('DROP TRIGGER IF EXISTS aolink_assign_tenant_trigger ON public.%I', table_name);
      EXECUTE format(
        'CREATE TRIGGER aolink_assign_tenant_trigger BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.aolink_assign_tenant()',
        table_name
      );
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', table_name);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I USING (public.aolink_tenant_allowed(tenant_id)) WITH CHECK (public.aolink_tenant_allowed(tenant_id))',
        table_name
      );
    END IF;
  END LOOP;
END $$;

-- Les flux d'authentification ont un contexte restreint avant de connaitre le tenant.
DO $$
DECLARE
  table_name TEXT;
  auth_tables TEXT[] := ARRAY[
  'users', 'email_verifications', 'password_resets', 'refresh_tokens',
  'suspicious_token_attempts', 'tenant_invitations'
];
BEGIN
  FOREACH table_name IN ARRAY auth_tables LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS authentication_scope ON public.%I', table_name);
      EXECUTE format(
        'CREATE POLICY authentication_scope ON public.%I USING (public.aolink_setting_true(''app.auth_scope'')) WITH CHECK (public.aolink_setting_true(''app.auth_scope''))',
        table_name
      );
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS platform_users_read ON public.users;
CREATE POLICY platform_users_read ON public.users FOR SELECT
USING (public.aolink_setting_true('app.platform_scope'));
DROP POLICY IF EXISTS current_user_identity ON public.users;
CREATE POLICY current_user_identity ON public.users FOR SELECT
USING (id = NULLIF(current_setting('app.user_id', true), '')::BIGINT);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
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

ALTER TABLE public.platform_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_audit_scope ON public.platform_audit_events;
CREATE POLICY platform_audit_scope ON public.platform_audit_events
USING (public.aolink_setting_true('app.platform_scope') OR public.aolink_migration_scope_allowed())
WITH CHECK (public.aolink_setting_true('app.platform_scope') OR public.aolink_migration_scope_allowed());

-- Unicites et FK composites principales : une reference ne peut pas changer de tenant.
ALTER TABLE public.users ADD CONSTRAINT users_id_tenant_unique UNIQUE (id, tenant_id);
ALTER TABLE public.projects ADD CONSTRAINT projects_id_tenant_unique UNIQUE (id, tenant_id);
ALTER TABLE public.companies ADD CONSTRAINT companies_id_tenant_unique UNIQUE (id, tenant_id);
ALTER TABLE public.lots ADD CONSTRAINT lots_id_tenant_unique UNIQUE (id, tenant_id);
ALTER TABLE public.rounds ADD CONSTRAINT rounds_id_tenant_unique UNIQUE (id, tenant_id);
ALTER TABLE public.items ADD CONSTRAINT items_id_tenant_unique UNIQUE (id, tenant_id);
ALTER TABLE public.options ADD CONSTRAINT options_id_tenant_unique UNIQUE (id, tenant_id);
ALTER TABLE public.option_items ADD CONSTRAINT option_items_id_tenant_unique UNIQUE (id, tenant_id);

ALTER TABLE public.companies ADD CONSTRAINT companies_tenant_name_unique UNIQUE (tenant_id, name);
CREATE UNIQUE INDEX companies_tenant_name_lower_idx ON public.companies (tenant_id, lower(name));

ALTER TABLE public.lots ADD CONSTRAINT lots_project_tenant_fk
  FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_project_tenant_fk
  FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.projects ADD CONSTRAINT projects_owner_tenant_fk
  FOREIGN KEY (owner_id, tenant_id) REFERENCES public.users(id, tenant_id);
ALTER TABLE public.users ADD CONSTRAINT users_company_tenant_fk
  FOREIGN KEY (company_id, tenant_id) REFERENCES public.companies(id, tenant_id);
ALTER TABLE public.round_lots ADD CONSTRAINT round_lots_round_tenant_fk
  FOREIGN KEY (round_id, tenant_id) REFERENCES public.rounds(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.round_lots ADD CONSTRAINT round_lots_lot_tenant_fk
  FOREIGN KEY (lot_id, tenant_id) REFERENCES public.lots(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.items ADD CONSTRAINT items_lot_tenant_fk
  FOREIGN KEY (lot_id, tenant_id) REFERENCES public.lots(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.offers ADD CONSTRAINT offers_item_tenant_fk
  FOREIGN KEY (item_id, tenant_id) REFERENCES public.items(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.offers ADD CONSTRAINT offers_company_tenant_fk
  FOREIGN KEY (company_id, tenant_id) REFERENCES public.companies(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.offers ADD CONSTRAINT offers_round_tenant_fk
  FOREIGN KEY (round_id, tenant_id) REFERENCES public.rounds(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.lot_companies ADD CONSTRAINT lot_companies_lot_tenant_fk
  FOREIGN KEY (lot_id, tenant_id) REFERENCES public.lots(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.lot_companies ADD CONSTRAINT lot_companies_company_tenant_fk
  FOREIGN KEY (company_id, tenant_id) REFERENCES public.companies(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.project_shares ADD CONSTRAINT project_shares_project_tenant_fk
  FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.project_shares ADD CONSTRAINT project_shares_user_tenant_fk
  FOREIGN KEY (shared_with_user_id, tenant_id) REFERENCES public.users(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.options ADD CONSTRAINT options_lot_tenant_fk
  FOREIGN KEY (lot_id, tenant_id) REFERENCES public.lots(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.options ADD CONSTRAINT options_round_tenant_fk
  FOREIGN KEY (round_id, tenant_id) REFERENCES public.rounds(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.option_items ADD CONSTRAINT option_items_option_tenant_fk
  FOREIGN KEY (option_id, tenant_id) REFERENCES public.options(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.option_item_offers ADD CONSTRAINT option_offers_item_tenant_fk
  FOREIGN KEY (option_item_id, tenant_id) REFERENCES public.option_items(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.option_item_offers ADD CONSTRAINT option_offers_company_tenant_fk
  FOREIGN KEY (company_id, tenant_id) REFERENCES public.companies(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.option_item_offers ADD CONSTRAINT option_offers_round_tenant_fk
  FOREIGN KEY (round_id, tenant_id) REFERENCES public.rounds(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.generated_questions ADD CONSTRAINT generated_questions_lot_tenant_fk
  FOREIGN KEY (lot_id, tenant_id) REFERENCES public.lots(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.generated_questions ADD CONSTRAINT generated_questions_company_tenant_fk
  FOREIGN KEY (company_id, tenant_id) REFERENCES public.companies(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.generated_questions ADD CONSTRAINT generated_questions_round_tenant_fk
  FOREIGN KEY (round_id, tenant_id) REFERENCES public.rounds(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.project_question_config ADD CONSTRAINT project_question_config_tenant_fk
  FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.lot_threshold_config ADD CONSTRAINT lot_threshold_config_tenant_fk
  FOREIGN KEY (lot_id, tenant_id) REFERENCES public.lots(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.lot_question_config ADD CONSTRAINT lot_question_config_tenant_fk
  FOREIGN KEY (lot_id, tenant_id) REFERENCES public.lots(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE public.tenant_invitations ADD CONSTRAINT invitations_company_tenant_fk
  FOREIGN KEY (company_id, tenant_id) REFERENCES public.companies(id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON public.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON public.projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_companies_tenant ON public.companies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON public.platform_audit_events(created_at DESC);
