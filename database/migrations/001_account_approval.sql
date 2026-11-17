BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_status VARCHAR(20);

UPDATE users
SET account_status = 'APPROVED'
WHERE account_status IS NULL
   OR role = 'admin'
   OR (is_active = TRUE AND account_status <> 'APPROVED');

ALTER TABLE users
  ALTER COLUMN account_status SET DEFAULT 'PENDING',
  ALTER COLUMN account_status SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_account_status_check'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_account_status_check
      CHECK (account_status IN ('PENDING', 'APPROVED', 'REJECTED'));
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_users_account_status
  ON users (account_status);
CREATE INDEX IF NOT EXISTS idx_users_pending_approvals
  ON users (created_at DESC)
  WHERE account_status = 'PENDING';

COMMIT;
