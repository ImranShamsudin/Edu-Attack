-- Safe upgrade for databases created from an earlier EduAttach schema.
-- Run this after schema.sql if the database already contains tables.

ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(150);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE attachments ADD COLUMN IF NOT EXISTS semester VARCHAR(100);
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE attachments ALTER COLUMN status SET DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_semester ON attachments(semester);
CREATE INDEX IF NOT EXISTS idx_attachments_status ON attachments(status);
