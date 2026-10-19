# Attachment Management Backend - Setup

## 1. Install dependencies
```bash
npm install
```

## 2. Set up PostgreSQL
Create the database first:
```sql
CREATE DATABASE attachment_db;
```

For a new database, run:
```bash
psql -U postgres -d attachment_db -f db/schema.sql
```

If you already have an older EduAttach database, run the upgrade script after the schema:
```bash
psql -U postgres -d attachment_db -f db/migrate.sql
```

## 3. Configure environment variables
Copy `.env.example` to `.env` and set the PostgreSQL connection details and JWT secret.

## 4. Run the server
```bash
npm start
```

The API runs at `http://localhost:5000` by default.

## Account and access rules

- **Students:** The Attachment Coordinator creates the account and gives the student an initial temporary password. On the first login, the student is forced to change the password.
- **University Supervisors:** A university supervisor can self-register from `register.html`. The Coordinator can also provision a university supervisor account with a temporary password when required; provisioned accounts must change that password on first login.
- **Industrial Supervisors:** Industrial supervisors can self-register. They should use the registration process provided by the system.
- **Coordinator/Admin:** The Coordinator manages accounts, placements, supervisor assignments, approval, and attachment status.

## Attachment tracking

Each attachment can store a semester/attachment period, start date, end date, placement status, supervisor assignments, approval information, and rejection reason. The Coordinator dashboard groups students into:

1. Not yet placed
2. Undergoing attachment
3. Completed attachment

The status overview can also be filtered by semester/period.
