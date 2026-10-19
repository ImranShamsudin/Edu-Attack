-- EduAttach database schema (complete, current version)
-- Fresh database:   npm run db:setup      (runs this file, then migrate.sql)
-- Existing database: npm run db:setup     (safe to re-run; everything is idempotent)

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,          -- always stored lower-case + trimmed
    phone VARCHAR(30),
    department VARCHAR(150),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL CHECK (role IN ('student', 'admin', 'industrial_supervisor', 'university_supervisor')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- Self-registered supervisors start as 'pending' until a coordinator approves them.
    approval_status VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved', 'pending')),
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    address VARCHAR(255),
    phone VARCHAR(30),
    email VARCHAR(150),
    primary_contact_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attachments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    industrial_supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    university_supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    semester VARCHAR(100),
    branch VARCHAR(150),
    duties_description TEXT,
    tools_used TEXT,
    additional_notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'rejected')),
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT attachments_dates_ok CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS logbook_entries (
    id SERIAL PRIMARY KEY,
    attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supervisor_feedback (
    id SERIAL PRIMARY KEY,
    logbook_entry_id INTEGER NOT NULL REFERENCES logbook_entries(id) ON DELETE CASCADE,
    supervisor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supervisor_visits (
    id SERIAL PRIMARY KEY,
    attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    university_supervisor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visit_number INTEGER NOT NULL CHECK (visit_number IN (1, 2)),
    comments TEXT NOT NULL,
    visit_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (attachment_id, visit_number)
);

CREATE TABLE IF NOT EXISTS weekly_reports (
    id SERIAL PRIMARY KEY,
    attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 52),
    week_ending DATE NOT NULL,
    report_text TEXT NOT NULL,
    supervisor_comment TEXT,
    supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    commented_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (attachment_id, week_number)
);

CREATE TABLE IF NOT EXISTS final_reports (
    id SERIAL PRIMARY KEY,
    attachment_id INTEGER NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    submitted_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS final_grades (
    id SERIAL PRIMARY KEY,
    attachment_id INTEGER NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE,
    marks NUMERIC(5,2) NOT NULL CHECK (marks >= 0 AND marks <= 100),
    comments TEXT,
    graded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    graded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_attachments_student ON attachments(student_id);
CREATE INDEX IF NOT EXISTS idx_attachments_semester ON attachments(semester);
CREATE INDEX IF NOT EXISTS idx_attachments_status ON attachments(status);
CREATE INDEX IF NOT EXISTS idx_attachments_uni_supervisor ON attachments(university_supervisor_id);
CREATE INDEX IF NOT EXISTS idx_attachments_ind_supervisor ON attachments(industrial_supervisor_id);
CREATE INDEX IF NOT EXISTS idx_logbook_attachment_date ON logbook_entries(attachment_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_feedback_entry ON supervisor_feedback(logbook_entry_id);
CREATE INDEX IF NOT EXISTS idx_orgs_name_lower ON organizations (LOWER(name));

-- A student may only have ONE open (pending or active) placement at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_attachment_per_student
  ON attachments (student_id) WHERE status IN ('pending', 'active');
