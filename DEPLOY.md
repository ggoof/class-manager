# Deploying Class Manager

```
  Browser
     │
     ├── https://futuretelling-d14bf.web.app ─────► Firebase Hosting   (the React SPA, Spark plan)
     │
     └── https://<service>.onrender.com/api/… ────► Fastify API on Render (free tier, Docker)
                                                        │
                                                        └── service account ──► Firestore
```

Firebase Hosting serves static files only, and running server code on Firebase
(Cloud Functions) needs the Blaze plan, so the API lives on Render and reaches
Firestore with a service-account key. Nothing but the API touches Firestore:
`firestore.rules` denies all client access, because every authorization rule in
this app is enforced in the Fastify routes.

Because the SPA and the API are on different origins, two values have to agree:
the API's `CORS_ORIGIN` (set in `render.yaml`) must list the Hosting URLs, and
the SPA's `VITE_API_BASE_URL` (in `frontend/.env.production`) must point at the
API. Get those wrong and the UI loads but every request fails.

## 1. Service-account key (once)

Console → **Project settings** → **Service accounts** → **Generate new private
key**. Save it as `backend/serviceAccount.json` (gitignored). It is full admin
access to the project and bypasses `firestore.rules`.

For Render, paste it base64-encoded — one line survives copy-paste:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("backend\serviceAccount.json")) | Set-Clipboard
```

## 2. Deploy the API on Render

1. Push this repo to GitHub.
2. Render → **New** → **Blueprint**, pick the repo. It reads `render.yaml`.
3. Fill in the two values it prompts for:

   | Variable                   | Value                                                                      |
   | -------------------------- | -------------------------------------------------------------------------- |
   | `JWT_SECRET`               | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
   | `FIREBASE_SERVICE_ACCOUNT` | the base64 key from step 1                                                  |

4. Check `https://<your-service>.onrender.com/api/health` returns `{"ok":true,...}`.

`render.yaml` pins `TZ=America/Los_Angeles`: class times are wall-clock values
expanded in server-local time, and Render runs in UTC.

> The free tier idles after ~15 minutes without traffic; the next request takes
> ~30–60 seconds while it wakes.

## 3. Point the SPA at the API and deploy it

In `frontend/.env.production` — no trailing slash, no `/api`:

```ini
VITE_API_BASE_URL="https://class-manager-api.onrender.com"
```

```bash
npm run deploy          # Firestore rules + indexes, then build and upload the site
```

## 4. Load the demo data

With `backend/.env` holding `FIREBASE_PROJECT_ID="futuretelling-d14bf"` and
`GOOGLE_APPLICATION_CREDENTIALS="./serviceAccount.json"`, on a machine set to
Pacific time:

```bash
npm run db:seed
```

This **deletes** everything in the app's collections first. Every seeded
account uses `password123`.

---

## Local development

**Against the emulator** — no credentials, no cloud writes:

```bash
npm run emulator      # terminal 1
npm run db:seed       # terminal 2, with FIRESTORE_EMULATOR_HOST set in backend/.env
npm run dev
```

**Against the real project** — keep `GOOGLE_APPLICATION_CREDENTIALS` set and
`npm run dev`. Vite proxies `/api` to Fastify, so there is no CORS to get wrong.

## Moving to Blaze later

`functions/` wraps the same Fastify app (`backend/src/app.ts`) as a Cloud
Function. On Blaze you can serve the API from the Hosting origin instead of
Render: add a `functions` block and an `/api/**` → `api` rewrite to
`firebase.json`, set `JWT_SECRET` with `firebase functions:secrets:set`, and
empty `VITE_API_BASE_URL`.

## Before you call it production

- [ ] `JWT_SECRET` is a real random value, set on Render.
- [ ] `CORS_ORIGIN` lists your Hosting URLs and nothing else.
- [ ] The service-account JSON is not in git and not in the frontend bundle.
- [ ] Seeded passwords are changed or the demo data is gone.
- [ ] `firestore.rules` still denies client access.
