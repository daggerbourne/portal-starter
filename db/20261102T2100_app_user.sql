CREATE TABLE IF NOT EXISTS app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  subject text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  state user_state NOT NULL DEFAULT 'invited',
  suspended_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  archived_at timestamptz,
  CONSTRAINT app_user_identity UNIQUE (provider, subject),
  CONSTRAINT app_user_suspended_reason CHECK (
    (state = 'suspended' AND suspended_reason IS NOT NULL AND length(btrim(suspended_reason)) > 0)
    OR (state <> 'suspended' AND suspended_reason IS NULL)
  )
);
