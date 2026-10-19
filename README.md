# EduAttach: Industrial Attachment Management System

Backend (Node.js + Express + PostgreSQL) and frontend (static HTML + Tailwind) for managing student
industrial attachments: placements, logbooks, weekly reports, supervisor visits, final reports and grading.

## Roles

| Role | How the account is created | What they do |
|---|---|---|
| **Coordinator (admin)** | First one: `npm run admin:create`. More: from the Dashboard. | Approves placements and supervisor sign-ups, assigns supervisors, grades final reports, manages companies and accounts, exports reports. |
| **Student** | Created by the coordinator (temporary password) | Submits a placement, then keeps a daily logbook and weekly reports, uploads the final report. |
| **University supervisor** | Self-registers (needs coordinator approval) or created by coordinator | Records 2 visits, comments on logbooks/weekly reports of assigned students. |
| **Industrial supervisor** | Self-registers (needs coordinator approval) or created by coordinator | Takes (or is assigned) students, comments on their logbooks/weekly reports. |

## Setup

Requires Node 18+ and PostgreSQL.

```bash
cd attachment-backend
npm install
cp .env.example .env        # then edit .env (see below)
npm run db:setup            # creates / upgrades every table; safe to re-run
npm run admin:create -- "Your Name" you@school.ac.ke "TempPassword1"
npm start
```

Open **http://localhost:5000**. The backend serves the frontend, so nothing else is needed.
(If you open the HTML files another way, e.g. VS Code Live Server, they call the API at
`http://localhost:5000`; set `window.API_BASE` before `js/api.js` to change that.)

### `.env`

`JWT_SECRET` is **required** (32+ characters; the server refuses to start without it). Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

See `.env.example` for the rest (database, `CORS_ORIGIN`, `JWT_EXPIRES_IN`).

### Upgrading an existing database

Just run `npm run db:setup`. It adds the new columns, lower-cases stored emails, and adds the new
constraints. If it reports a duplicate-key error it names the problem (two accounts whose emails differ
only by letter case, or a student with two open placements); fix that row and run it again.

> Because `last_login` is new, the Reports page shows existing students as "never logged in" until
> they sign in once more.

### Lost access?

```bash
npm run admin:reset-password -- someone@school.ac.ke "NewTempPassword1"
```

Coordinators can also reset anyone's password from **Accounts**; the user must choose a new one at next login.

## Workflow

1. Coordinator creates student accounts (Dashboard → Create Account) and shares the temporary password.
2. Student signs in (forced to choose a new password), submits a **Placement**.
3. Coordinator **approves** it. Only then can the student log entries, write weekly reports and upload the final report.
4. Supervisors are assigned by the coordinator or take students themselves (one supervisor of each type per student).
5. University supervisor records visits 1 and 2; supervisors comment on entries and weekly reports.
6. Coordinator reviews logbook + reports + final report, grades it, and marks the placement **Completed**.

## Security notes

- Passwords: bcrypt, minimum 8 characters. Login is rate-limited (10 attempts / 15 min per IP + email).
- Deactivating a user, un-approving them or changing their role takes effect on their very next request.
- "Must change password" is enforced by the server, not only the browser.
- Uploaded final reports live outside the web root and are only downloadable through the authenticated route;
  content is checked against the file extension and stored under a random name.
- All user-supplied text is HTML-escaped before display (no stored XSS), CSV exports neutralise spreadsheet formulas.
- **Never commit `.env`.** It is in `.gitignore`.

## Project layout

```
attachment-backend/   Express API (routes/, middleware/, db/, scripts/, utils/)
attachment-frontend/  Static pages (js/api.js shared helpers, js/admin-shell.js coordinator layout)
```
