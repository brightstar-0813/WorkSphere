# WorkSphere

Multi-user daily work platform: job handle, job hunting + calendar, income/expense, discuss & reports.

## Stack

- **Web**: React + Vite + i18n (EN / KO / ZH / RU)
- **API**: Node + Express + Prisma
- **DB**: PostgreSQL

## Roles

- `USER` — own data only
- `ADMIN` — all users (`/admin`)

## Quick start

```bash
# Node 22+ recommended (skills CLI needs 22+)
nvm use 22

# Postgres — either Docker:
docker compose up -d db
# or a local Postgres with DATABASE_URL in apps/api/.env
# Default: postgresql://worksphere:worksphere@localhost:5432/worksphere

# Install
npm install

# Migrate + seed
cd apps/api
npx prisma migrate dev
npm run db:seed
cd ../..

# Run (two terminals)
npm run dev:api
npm run dev:web
```

- Web: http://localhost:5173
- API: http://localhost:4000/api/v1/health

### Seed accounts

| Role  | Email                   | Password |
|-------|-------------------------|----------|
| ADMIN | admin@worksphere.local  | admin123 |
| USER  | user@worksphere.local   | user123  |

## Project skills

- `.cursor/skills/worksphere` — product/domain conventions
- `.agents/skills/*` — find-skills, React best practices, web design guidelines, Prisma

## Calendar email integrations (Gmail / Outlook)

WorkSphere can sync events from Google Calendar and Microsoft Outlook and send invites through the connected account.

1. Copy `apps/api/.env.example` values into `apps/api/.env`
2. Create OAuth apps:
   - **Google**: Cloud Console → enable Calendar API → OAuth client (Web) with redirect  
     `http://localhost:4000/api/v1/integrations/google/callback`
   - **Microsoft**: Entra app registration → redirect  
     `http://localhost:4000/api/v1/integrations/outlook/callback`  
     Delegated permissions: `Calendars.ReadWrite`, `User.Read`, plus `offline_access`
3. Restart the API, open **Calendar** → **Accounts**
4. Use **Add account** under Gmail or Outlook as many times as needed (pick a different inbox each time). ICS URLs can also be added repeatedly.
5. Use **Sync** to pull events from all connected accounts; when creating an event, add invitee emails to send invites via a connected account

**Outlook:** paste ICS / webcal URL under External calendars.

**Gmail:** enter a Gmail address → Send invite → they Accept with Gmail → you see their events. Requires `GOOGLE_CLIENT_*` in API `.env`. Optional SMTP for real inbox delivery.

Without OAuth keys, **Add account** stays disabled; ICS URL import still works.

## Tools → Transcript

**Sidebar → Tools → Transcript** turns a recording into a clean, speaker-labelled
transcript with no timestamps.

- Input: MP4, WebM, MOV, MKV, MP3, M4A, WAV, OGG, FLAC — anything the browser can decode
- Speech recognition: Whisper via ONNX (`@huggingface/transformers`), WebGPU when available, CPU/WASM otherwise
- Speaker labels: `pyannote/segmentation-3.0`; rename a speaker and the name updates everywhere
- Output: speaker-grouped paragraphs, copy to clipboard or download as `.txt` / `.md`

**No API keys, no per-minute cost, and nothing uploaded** — decoding and transcription
run in a Web Worker on the user's own machine, and only the finished text reaches the
API. Transcripts are private per user (ADMIN can scope with `?userId=`).

Model weights (~45 MB for Tiny up to ~820 MB for Large v3 Turbo) download from the
Hugging Face CDN on first use and are then cached by the browser. Transcription speed
depends on the machine: WebGPU is roughly real-time, CPU/WASM is several times slower,
so prefer Tiny or Base without a GPU.

The ONNX runtime itself is served from this app. `apps/web/scripts/copy-ort.mjs`
vendors it into `apps/web/src/vendor/ort` on `predev` / `prebuild` (gitignored), which
also puts a ~21 MB `.wasm` in `apps/web/dist`. Keep that step — without it
transformers.js falls back to a jsdelivr CDN and the tool fails with
`no available backend found` anywhere that CDN is unreachable.

## Later

## Deploy (free): Neon + Render + Vercel

Others need a public URL. Use this free stack:

1. **Neon** — Postgres  
2. **Render** — API (`apps/api`)  
3. **Vercel** — web (`apps/web`) with `VITE_API_URL` = your Render URL  

### 1) Neon database

1. Sign up at [console.neon.tech](https://console.neon.tech)  
2. Create a project → copy the connection string  
3. Prefer the **direct** (non-pooler) URL for Prisma migrations, or use Neon’s Prisma connection string as shown in their dashboard  
4. Keep `?sslmode=require` if present  

Optional: run migrations from your PC first:

```bash
cd apps/api
# temporarily set DATABASE_URL to the Neon URL in .env (or export it)
npx prisma migrate deploy
npm run db:seed
```

Change seed passwords before sharing publicly.

### 2) Render API

1. Push this repo to GitHub  
2. [Render](https://render.com) → **New → Web Service** → connect the repo  
3. Settings (use **repo root**, not `apps/api` — this is an npm workspaces monorepo):

| Field | Value |
|--------|--------|
| Root Directory | *(leave empty)* |
| Runtime | Node |
| Build Command | `npm install && npm run build -w @worksphere/api` |
| Start Command | `npm run start:prod -w @worksphere/api` |

4. Environment variables:

| Key | Value |
|-----|--------|
| `DATABASE_URL` | Neon connection string |
| `JWT_SECRET` | long random string (not the local default) |
| `WEB_ORIGIN` | your Vercel URL (update after step 3), e.g. `https://worksphere.vercel.app` |
| `API_PUBLIC_URL` | your Render URL, e.g. `https://worksphere-api.onrender.com` |

Render sets `PORT` automatically — do not hardcode it unless you know you need to.

5. Deploy → open `https://YOUR-API.onrender.com/api/v1/health`  
   Free tier may sleep after idle; first request can take ~30–60s.

### 3) Vercel web

1. [Vercel](https://vercel.com) → **Add New Project** → same GitHub repo  
2. Settings:

| Field | Value |
|--------|--------|
| Root Directory | `apps/web` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `cd ../.. && npm install` |

If Vercel’s monorepo install fails, set **Root Directory** to the repo root and:

| Field | Value |
|--------|--------|
| Build Command | `npm run build -w @worksphere/web` |
| Output Directory | `apps/web/dist` |
| Framework | Other / Vite |

3. Environment variable:

| Key | Value |
|-----|--------|
| `VITE_API_URL` | Render API origin, **no** trailing slash, e.g. `https://worksphere-api.onrender.com` |

4. Deploy → set Render’s `WEB_ORIGIN` to this Vercel URL and redeploy the API if needed  

Locally, leave `VITE_API_URL` unset so Vite’s `/api` proxy still works.

### Shipping a change

Neither host deploys from GitHub — a push does **not** ship anything. Deploy
both from the repo root:

```bash
npm run deploy        # API (Railway) then web (Vercel), in that order
```

Or one at a time: `npm run deploy:api`, `npm run deploy:web`.

Order matters. The API carries the Prisma migration (`start:prod` runs
`prisma migrate deploy` on boot), so shipping the web app first leaves the
frontend calling routes the API does not have yet.

Run these from the repo root, not `apps/web` — `deploy:web` passes
`--cwd apps/web` itself. Running `vercel --prod` from the root by hand fails
with `No Output Directory named "dist"`, because the project Root Directory is
relative to the linked `apps/web` folder.

### After deploy

- Share the Vercel URL with other users  
- They register (or you create users as admin)  
- Calendar OAuth (optional): add production redirect URIs in Google/Microsoft consoles using `API_PUBLIC_URL`  
- Uploaded avatars live on the Render filesystem (ephemeral on free tier — fine for demos)

### Temporary alternative

[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) or ngrok can expose your local `5173`/`4000` for a quick demo without hosting — your PC must stay on.

