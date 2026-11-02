DO $$ BEGIN
  CREATE TYPE role AS ENUM ('user', 'staff', 'owner', 'system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_state AS ENUM ('invited', 'active', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
