-- Idempotent upgrade script. Safe to run any number of times, on any older EduAttach database.
-- (npm run db:setup runs schema.sql first, then this file.)

-- ---- users ---------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(150);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_approval_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_approval_status_check CHECK (approval_status IN ('approved', 'pending'));
  END IF;
END $$;

-- Emails are now matched case-insensitively. Normalise what is already stored.
-- (If this fails with a duplicate-key error, two accounts differ only by letter case:
--  delete or rename one of them, then run it again.)
UPDATE users SET email = LOWER(TRIM(email)) WHERE email <> LOWER(TRIM(email));
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email_lower ON users (LOWER(email));

-- ---- organizations ---------------------------------------------------------
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email VARCHAR(150);
CREATE INDEX IF NOT EXISTS idx_orgs_name_lower ON organizations (LOWER(name));

-- ---- attachments -----------------------------------------------------------
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS semester VARCHAR(100);
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS branch VARCHAR(150);
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS duties_description TEXT;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS tools_used TEXT;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS additional_notes TEXT;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE attachments ALTER COLUMN status SET DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachments_dates_ok') THEN
    ALTER TABLE attachments ADD CONSTRAINT attachments_dates_ok CHECK (end_date >= start_date) NOT VALID;
  END IF;
END $$;

-- A student may only have ONE open (pending or active) placement at a time.
-- (If this fails, a student already has two open placements: reject/complete one first.)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_attachment_per_student
  ON attachments (student_id) WHERE status IN ('pending', 'active');

CREATE INDEX IF NOT EXISTS idx_attachments_semester ON attachments(semester);
CREATE INDEX IF NOT EXISTS idx_attachments_status ON attachments(status);
CREATE INDEX IF NOT EXISTS idx_logbook_attachment_date ON logbook_entries(attachment_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_feedback_entry ON supervisor_feedback(logbook_entry_id);

-- ---- weekly reports ----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weekly_reports_week_range') THEN
    ALTER TABLE weekly_reports ADD CONSTRAINT weekly_reports_week_range CHECK (week_number BETWEEN 1 AND 52) NOT VALID;
  END IF;
END $$;

-- ---- settings ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);
