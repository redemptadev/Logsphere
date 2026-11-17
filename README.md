# LogSphere

LogSphere is a server log management system for Nairobi Tech Hub. The application uses a React/Vite frontend, Express REST API, and PostgreSQL for persistent records.

## Features

- JWT sign-in, registration, email verification, password reset, and sign-out.
- Public registration creates inactive, pending Viewer accounts; an administrator must approve each registration before login.
- Admin, analyst, and viewer roles enforced by backend middleware.
- Database-backed dashboards, search, filters, paginated log lists, and individual log details.
- Admin and analyst log creation and file imports for `.log`, `.txt`, and `.csv`.
- Log uploads are validated and imported transactionally, with rejected-row reasons, duplicate protection, live dashboard metrics, and upload history.
- Admin deletion confirmation codes delivered by email.
- Database-backed severity, trend, and source reporting with CSV export.
- Admin registration approvals, user management, and audit history.

The application does not fall back to sample or in-memory application data. Dashboard and report figures are calculated from PostgreSQL records. `database/demo_seed.sql` is optional, explicit development data for local demonstrations.

## Prerequisites

- Node.js 20.19+ (Vite 8 requirement)
- npm
- PostgreSQL 14+
- Brevo SMTP account for outgoing verification and deletion emails

## Install

From PowerShell:

```powershell
cd "C:\Users\hp\OneDrive\Desktop\Project 2026\Logsphere_project"
npm install
cd .\frontend
npm install
```

## PostgreSQL and environment

1. Create a database, for example `logsphere`, in PostgreSQL/pgAdmin.
2. Copy the sample configuration and edit its values:

```powershell
cd "C:\Users\hp\OneDrive\Desktop\Project 2026\Logsphere_project"
Copy-Item .env.example .env
```

3. Configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` for that database. Set `JWT_SECRET` to a new random value with at least 32 characters. Do not commit `.env`.
4. For a new, empty database, initialize the schema:

```powershell
psql -U postgres -d logsphere -f .\database\schema.sql
```

The API also applies the fresh-install schema at startup with `CREATE TABLE/INDEX IF NOT EXISTS`.

### Upgrade an existing database

Before starting the updated API against an existing `logsphere` database, apply the additive account-approval migration once. It does not drop tables or delete existing records. Existing users are marked approved; admin accounts remain approved. Do not run `schema.sql` as a substitute for this migration on an existing installation.

```powershell
cd "C:\Users\hp\OneDrive\Desktop\Project 2026\Logsphere_project"
psql -U postgres -d logsphere -v ON_ERROR_STOP=1 -f .\database\migrations\001_account_approval.sql
```

Replace `postgres` with your PostgreSQL username if needed. If `psql` is not on PATH, run the migration file in pgAdmin's Query Tool while connected to `logsphere`.

## Brevo SMTP

In Brevo, obtain SMTP credentials (not an API key) and set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM` in `.env`. `MAIL_FROM` must be a sender identity verified in the Brevo account; using an unverified Gmail sender can be rejected by the relay. The application uses STARTTLS on port 587 and implicit TLS on port 465. Set `ADMIN_EMAIL` to the address that must receive deletion confirmation codes. Email-dependent flows return an explicit error if SMTP is not configured or the provider rejects the message.

## Create the first administrator

After schema initialization and `.env` setup, run the interactive command in a PowerShell terminal. The password is entered without echo and is never placed in command arguments:

```powershell
npm run create-admin
```

The created administrator is active and email-verified. Public registration always assigns the viewer role.

## Start the application

In one PowerShell window:

```powershell
cd "C:\Users\hp\OneDrive\Desktop\Project 2026\Logsphere_project"
npm run dev
```

In a second window:

```powershell
cd "C:\Users\hp\OneDrive\Desktop\Project 2026\Logsphere_project\frontend"
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). The Express API listens on port `5000` by default.

## Optional demo data

After initializing an empty database, insert five real PostgreSQL demonstration rows:

```powershell
psql -U postgres -d logsphere -f .\database\demo_seed.sql
```

This script is never run automatically and preserves any pre-existing records.

## Tests and build

```powershell
cd "C:\Users\hp\OneDrive\Desktop\Project 2026\Logsphere_project"
npm test
cd .\frontend
npm run lint
npm run build
```

`npm test` includes upload parser coverage and route-level upload tests using a transactional database mock; it does not verify writes to your live PostgreSQL database. Live database and SMTP-dependent flows must be exercised after local configuration.

## Main API routes

- `POST /api/auth/register`, `/login`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`, `/logout`
- `GET /api/auth/me`
- `GET /api/dashboard?range=24h|7d|30d|custom`
- `GET /api/logs` (pagination and `search`, `severity`, `service`, `from`, `to` filters)
- `GET /api/logs/:id`, `POST /api/logs`, `PUT /api/logs/:id`
- Admin/analyst: `POST /api/logs/upload`; authenticated users: `GET /api/logs/files`
- Admin deletion flow: `POST /api/logs/:id/deletion-request` then `POST /api/logs/:id/deletion-confirmation`
- `GET /api/reports`, `GET /api/reports/export`
- Admin: `GET /api/users` (search and role/status filters), `GET /api/users/pending`, `GET /api/users/:id`, `POST /api/users/:id/approve`, `POST /api/users/:id/reject`, `PATCH /api/users/:id`, `GET /api/audit`
- `GET /api/health`

All private routes require `Authorization: Bearer <JWT>`.

## Roles

- **Admin:** full access, user administration, audit history, and emailed-code log deletion.
- **Analyst:** read/write logs, import files, reports, and CSV export; cannot manage users or delete logs.
- **Viewer:** dashboard and read-only log/report access.

## Log upload formats

Uploads are limited to 5 MB and 10,000 records. CSV files should include `timestamp`, `severity`, `service_name` (or `service`), and `message`; optional columns include `log_id`, `source`/`host`, `ip_address`/`ip`, `http_status`/`status`, and JSON `metadata`. `.log` and `.txt` accept one JSON object per line or timestamp/severity/service/message lines such as `2026-11-12 10:00:00 ERROR API: Request failed`. Supplied log IDs are retained; missing IDs are generated deterministically so re-uploading the same file does not create duplicates. Invalid rows are counted and returned with reasons.
