---
name: worksphere
description: >-
  Build and extend WorkSphere, a multi-user React+Node+Postgres daily work
  platform (job handle, job hunting, calendar, income/expense, discuss, reports,
  job capture, bid-bot sync). Use when working in the WorkSphere repo, adding
  modules, APIs, schema, i18n, or admin/user features.
---

# WorkSphere

## Stack

- **Frontend**: React (Vite), TypeScript
- **Backend**: Node.js (Express or Fastify), TypeScript
- **DB**: PostgreSQL + Prisma
- **Auth**: JWT or session cookies; roles `USER` | `ADMIN`
- **i18n**: English, Chinese, Russian (UI strings only in locale files)

Prefer monorepo: `apps/web`, `apps/api`, `packages/shared` when scaffolding.

## Roles

| Role | Access |
|------|--------|
| `USER` | Own data only (jobs, calendar, money, discuss, reports) |
| `ADMIN` | All users' data; user management; cross-user reports |

Every query that returns user-owned rows must filter by `userId` unless the actor is `ADMIN` (and admin routes are explicit).

## MVP modules

1. **Job handle** — one record per **client/engagement** you run (e.g. Sycomp, DMI); per day: todos, blockers, progress, schedules
2. **Job hunting** — applications/pipeline + **calendar** for interviews/follow-ups
3. **Income / expense** — transactions, categories, basic totals
4. **Discuss & Report** — discussion threads (tied to jobs/users) + summary reports

### Adjacent (design for, implement after MVP core)

- **Job capture** — ingest openings (paste, webhook, later extension)
- **Bid bot sync** — WorkSphere is source of truth; bot executes bids; bidirectional status sync
  - Existing bot lives in `brightstar-auto-apply-bot/` (Chrome extension); integrate via API/webhooks later — do not scrape third-party sites from the API

## Domain rules

- Multi-tenant by `userId` on all owned entities
- Calendar events link to jobs / hunting / money when possible (`sourceType` + `sourceId`)
- Optional **Gmail / Outlook** calendar OAuth: multiple accounts per user (`GOOGLE` / `OUTLOOK`); mirror external events and send invites via a connected account
- **CalendarShare**: request → accept → view another WorkSphere user’s events (read-only)
- **CalendarIcsFeed**: paste published Outlook/ICS URLs (many per user)
- Money amounts stored as integer minor units (cents) + `currency` code
- Soft-delete only when history matters (bids, transactions); otherwise hard delete OK for drafts
- Do not scrape or automate third-party job platforms in-repo; integrate via user-provided capture payloads and the user's own bid-bot API contract

## API conventions

- REST under `/api/v1/...`
- Auth middleware on all non-public routes
- Admin routes under `/api/v1/admin/...`
- List endpoints: pagination (`page`, `pageSize`), consistent `{ data, meta }`
- Errors: `{ error: { code, message } }`

## UI conventions

- Locale switcher; default `en`
- No hardcoded user-facing strings in components — use i18n keys
- Admin screens clearly separated (e.g. `/admin/*`)
- Prefer existing design patterns in the repo once UI exists; until then keep layouts simple and functional
- **Job handle UX** — enterprise ITSM ops console: engagement catalog (left) + active engagement workspace (right); deep-link `?job=` and `?date=`; KPI strip; work queue (status | editable work item title | editable description | delete) + once/recurring schedules
- Typography: IBM Plex Sans / Mono; status via `StatusBadge`; honor `prefers-reduced-motion` and `:focus-visible`

## When adding a feature

1. Confirm module and role access (USER vs ADMIN)
2. Update Prisma schema + migration
3. API with ownership checks
4. Web UI + i18n keys for `en`, `ko`, `zh`, `ru`
5. Link to calendar / reports if the feature creates dates or money

## Additional resources

- Domain model sketch: [reference.md](reference.md)
