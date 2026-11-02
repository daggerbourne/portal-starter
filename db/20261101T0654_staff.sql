CREATE TABLE IF NOT EXISTS staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_object_id text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  role role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  archived_at timestamptz,
  CONSTRAINT staff_entra_object_id_unique UNIQUE (entra_object_id),
  CONSTRAINT staff_role_check CHECK (role IN ('staff', 'owner'))
);
