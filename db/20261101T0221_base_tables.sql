CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL, version integer NOT NULL, value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL, archived_at timestamptz,
  CONSTRAINT settings_version UNIQUE (key, version),
  CONSTRAINT settings_version_positive CHECK (version >= 1),
  CONSTRAINT settings_key CHECK (key IN ('display_name', 'support_email'))
);

CREATE TABLE IF NOT EXISTS audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter text NOT NULL, mode text NOT NULL, context text NOT NULL, outcome text NOT NULL, occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL, archived_at timestamptz
);
