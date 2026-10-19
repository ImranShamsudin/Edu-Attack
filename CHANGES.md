# What was fixed

## Blockers (things that simply did not work)
- **Placement submission crashed on any database built from `schema.sql`**: it inserted columns
  (`duties_description`, `tools_used`, `additional_notes`) that did not exist. Added, plus `branch`, organization `phone`/`email`.
  The form also collected branch/phone/org email and the server silently dropped them; now saved.
- **Reports page** called two endpoints that did not exist (`/admin/reports/activity` and its export) and needed a
  `last_login` that was never recorded. Both endpoints implemented; `last_login` is now tracked.
- **Company contact dropdown was always empty** (server rejected the `industrial_supervisor` filter). Fixed; coordinators can
  now also create industrial supervisors, and assign/change a company's contact from the Companies page.
- **"Completed" could never happen**: no UI called the complete endpoint. Added; Deactivate, Reset password, Edit user and CSV export are now in the UI too.
- **Admin sidebar links** pointed to student-only pages (Assessments, Reports) and bounced the coordinator back. New shared
  coordinator layout with working links on every admin page.
- **Login was case-sensitive on email.** Emails are now normalised everywhere (and the DB migration lower-cases stored ones).
- **No way to create the first coordinator** or recover a lost password: added `npm run admin:create` / `admin:reset-password`
  and an in-app password reset.
- Placement form allowed an empty end date that the server then rejected; now required and validated on both sides.
- Dates could shift by one day (time-zone bug in date handling); dates are now plain `YYYY-MM-DD` end to end. Marks no longer display as "85.00".
- Pages used `attachments[0]` (newest) as "my placement", which could be a rejected one; they now pick the relevant placement.

## Security
- `.env` (DB password, JWT secret) was committed and pushed. **Rotate both** (see below). `.gitignore` added.
- The whole backend folder (source, SQL, uploaded reports) was served as static files; only the frontend is served now.
- Stored XSS: student-entered text was rendered unescaped on coordinator/supervisor pages while the JWT sits in `localStorage`. All output is escaped.
- Any logged-in user (even a student) could create organizations or change a company's contact. Admin only now.
- Any supervisor could see every student and take any placement. Now they see their own students plus approved placements with no supervisor of their type; taking one is atomic.
- Self-registered supervisors are **pending until the coordinator approves** them.
- Tokens are re-checked against the database on each request (deactivation/role change is immediate); must-change-password is server-enforced.
- Login rate limiting, constant-time failure path, 8-character minimum, server refuses to start without a strong `JWT_SECRET`.
- Uploads: random filenames, magic-byte check, old file deleted on replace, JSON errors for upload problems.
- Coordinator cannot deactivate or demote themselves. CSV export protected against formula injection.

## Validation / data integrity
Real-date checks, end ≥ start (also a DB constraint), week 1-52, marks 0-100 and numeric, one open placement per student
(DB-enforced), logbook entries only for an approved placement, inside its period and not in the future, weekly reports locked
once reviewed, one supervisor comment per report (no silent overwrite), grading requires a submitted report and blocks replacing a graded one.

## Cleanup
Debug `console.log`s removed, `hash.js` (hard-coded password) and `diagnose-login.js` deleted, `reset-password.js` moved to `scripts/`,
dead buttons and hot-linked placeholder photos/names removed, dead "Forgot password?" now explains the reset process.

# Do this now (you must do these yourself)
1. **Rotate secrets:** change your PostgreSQL password and generate a new `JWT_SECRET`; they were in a pushed commit.
2. Stop tracking the junk:
   ```bash
   git rm -r --cached attachment-backend/node_modules attachment-backend/.env attachment-backend/uploads
   git rm --cached "*.lnk" 2>/dev/null
   git add .gitignore && git commit -m "Stop tracking secrets and dependencies"
   ```
   The old `.env` is still in git history; if the repo is public, treat those credentials as burned (rotating fixes that).
3. `cd attachment-backend && npm install && npm run db:setup`.
