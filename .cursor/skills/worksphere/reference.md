# WorkSphere domain reference

## Core entities (MVP)

```
User
  id, email, passwordHash, role (USER|ADMIN), locale, createdAt

Job (job handle = client / engagement)
  id, userId, title (e.g. "Sycomp", "DMI"), status, priority, dueAt, description, createdAt
  — many clients per user; schedules via CalendarEvent (sourceType=JOB)

JobDayLog (per job × calendar day)
  id, jobId, userId, day (UTC date), unique(jobId, day)

JobDayItem
  id, logId, body (short description), status (TODO|IN_PROGRESS|DONE|FAILED|BACKLOG|OVERDUE), sortOrder
  — new items always start as TODO; status and description are editable

HuntingProfile (job hunting identity)
  id, userId, name, label?, active, spreadsheetUrl?, sheetsWebAppUrl?, sheetSyncedAt?

CapturedJob (job fetch inbox per profile — from sf-job-capture bot / CSV / manual)
  id, userId, profileId, externalId?, platform?, title, company, sourceUrl?, salary?, description?, status (NEW|QUEUED|DISMISSED|BIDDED)

HuntingProfile …
  captureBotUrl (default http://127.0.0.1:3847), captureSyncedAt
  spreadsheetUrl, sheetsWebAppUrl, sheetTabName (one tab per profile in shared Bid Tracking sheet), sheetSyncedAt

HuntingBid (bid tracking per profile; MANUAL or SHEET)
  id, userId, profileId, company, roleTitle, status, source, sheetKey?, sourceUrl?, salary?, notes, amountMinor?, currency, appliedAt?

HuntingInterview (interview tracking per profile; optional bidId)
  id, userId, profileId, bidId?, company, roleTitle, status, notes, scheduledAt?, scheduleEndsAt?
  — calendar schedules via CalendarEvent (sourceType=HUNTING, sourceId=interviewId)

CalendarEvent
  id, userId, title, startsAt, endsAt, sourceType?, sourceId?

CalendarShare (request → accept → view owner's events read-only)
  id, requesterId, ownerId, status (PENDING|ACCEPTED|DECLINED)

CalendarIcsFeed (Outlook / other published ICS URL)
  id, userId, url, label, lastSyncAt

Transaction (income/expense)
  id, userId, type (INCOME|EXPENSE), amountMinor, currency, category, occurredAt, note

Discussion
  id, userId, title, body, linkedType?, linkedId?, createdAt

DiscussionReply
  id, discussionId, authorId, body, createdAt
```

## Capture & bid bot (post-MVP shape)

```
CapturedJob
  id, userId, externalId?, platform?, title, description, budget?, payloadJson, status, capturedAt

Bid
  id, userId, capturedJobId, amountMinor?, proposalText?, status, botRef?, syncedAt, resultJson?
```

### Sync contract (high level)

- WorkSphere → bot: queue eligible `CapturedJob` + bid params
- Bot → WorkSphere: webhook/API updates `Bid.status` and timestamps
- Never store third-party session cookies in the DB without explicit secure secret handling

## Admin views

- User list + detail (jobs, hunting, transactions, discussions, calendar)
- Aggregate reports across users
- Optional: pause/disable a user account

## Report examples

- Per-user: income vs expense by period
- Hunting funnel: bid + interview status counts
- Job handle: overdue / completed
- Admin: same metrics scoped to one user or all users
