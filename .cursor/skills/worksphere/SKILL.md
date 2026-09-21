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
- **Default time zone**: `Asia/Tokyo` (UTC+9) for new users, empty profiles, and period day boundaries

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
4. **Discuss & Report** — real-time shared channels + summary reports
5. **Tools** — self-serve utilities that are not part of the daily-work loop; first one is **Transcript** (media → speaker-labelled text, transcribed in the browser)

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
- **Tools → Transcript**: media never leaves the browser — Whisper + pyannote run in a Web Worker and the API only stores the finished turns (`Transcript.segments`) and speaker names; transcripts are per-user like jobs/money
- **Job capture / New jobs** — captured openings are **shared workspace-wide** (all users see the same feed); domains listed via `GET /hunting/profiles?scope=all`; bid tracking and personal calendars stay per-user unless noted otherwise
- Soft-delete only when history matters (bids, transactions); otherwise hard delete OK for drafts
- Do not scrape or automate third-party job platforms in-repo; integrate via user-provided capture payloads and the user's own bid-bot API contract

## API conventions

- REST under `/api/v1/...`
- Auth middleware on all non-public routes
- Admin routes under `/api/v1/admin/...`
- List endpoints that power paged UI: pagination (`page`, `pageSize`) with `{ data, meta }` (`listMeta` / `parsePagination`)
- Calendar range queries stay `{ data }` (filter by `from`/`to`, not page)
- Errors: `{ error: { code, message } }`
- Period / civil-day math: actor `timeZone` (JWT or DB) → fallback `Asia/Tokyo`; use `resolveActorTimeZone` + `period.ts`
- Ownership: `ownerFilter` — non-admin always own rows; admin + `?userId=` scopes to that user; admin without `userId` on **user** routes still sees own data (use `/api/v1/admin/*` for cross-tenant)

## UI conventions

- Locale switcher; default `en`
- No hardcoded user-facing strings in components — use i18n keys (including placeholders)
- Admin screens clearly separated (e.g. `/admin/*`)
- Shared chrome: `PageHeader`, `PageState`, `PeriodToolbar`, `Pagination`, `StatusBadge`, `ConfirmDialog`
- Authenticated pages: header + loading + empty + mutation errors via alerts/`notify`
- Status enums in badges: always `t(...)` labels, never raw enum strings
- Prefer Job Handle ITSM patterns for ops modules; Calendar may keep GCal shell but must share tokens, a11y, and loading
- **Job handle UX** — enterprise ITSM ops console: engagement catalog (left) + active engagement workspace (right); deep-link `?job=` and `?date=`; KPI strip; work queue (status | editable work item title | editable description | delete) + once/recurring schedules
- Typography: IBM Plex Sans / Mono; status via `StatusBadge`; honor `prefers-reduced-motion` and `:focus-visible`

## Consistency gates

1. Paged UI lists return `{ data, meta }` from the API
2. Period UIs use user TZ → Tokyo fallback end-to-end
3. No raw status enums in user-facing badges
4. No page without loading/empty/error path
5. Interactive controls are buttons/links with labels; icon-only have `aria-label`
6. User-facing copy only via locale files

## When adding a feature

1. Confirm module and role access (USER vs ADMIN)
2. Update Prisma schema + migration
3. API with ownership checks
4. Web UI + i18n keys for `en`, `zh`, `ru` (and `ko` when shipped)
5. Link to calendar / reports if the feature creates dates or money
6. Pass the consistency gates above

## Additional resources

- Domain model sketch: [reference.md](reference.md)
