# Class Manager

A web-based class management system with three roles — **admin**, **teacher** and **student** —
each with its own console.

```
class_manager/
├── shared/     TypeScript types + constants used by both sides
├── backend/    Fastify API on Firestore (firebase-admin)
└── frontend/   React + Vite SPA, deployed to Firebase Hosting
```

## Getting started

The quickest start needs no Firebase credentials at all — run the Firestore
emulator and point the API at it.

```bash
npm install
npm run emulator     # terminal 1: Firestore emulator on :8080 (needs Java)
```

Uncomment `FIRESTORE_EMULATOR_HOST` in `backend/.env`, then:

```bash
npm run db:seed      # terminal 2: loads demo data
npm run dev          # API on :3000, web UI on :5173
```

Then open <http://localhost:5173>. New users can **create their own student account**
from the sign-in screen ("Create a student account"); teachers and admins are provisioned
by an admin.

To develop against the real Firebase project instead, put a service-account key
where `backend/.env` can find it — see [DEPLOY.md](DEPLOY.md) step 2 — and skip
the emulator. **[DEPLOY.md](DEPLOY.md) is the guide for shipping this to
Firebase Hosting.**

### Demo accounts

Every seeded account uses the password `password123`.

| Role    | Username                | What they see                          |
| ------- | ----------------------- | -------------------------------------- |
| Admin   | `admin`                 | Everything — all data, edit, export     |
| Teacher | `tanaka`                | MATH-201, PHYS-110                      |
| Teacher | `mwangi`                | BIO-150                                 |
| Teacher | `silva`                 | HIST-101                                |
| Teacher | `petrov`                | CS-130                                  |
| Student | `alice` … `lena` (12)   | Three classes each                      |

The seed also leaves **ART-090 unassigned** and **two change requests pending**, so the
admin console has real work waiting on it.

## What each role can do

### Admin — full control

- **Dashboard** — headcounts, today's sessions across the whole school, and a
  "needs attention" list (pending requests, classes with no teacher).
- **Users** — create, edit and delete any account; set the role; reset passwords;
  deactivate accounts; search across name, username, email and phone; export to CSV.
  Every user carries username, real name, email, age, phone and emergency contact
  (name, phone, relationship).
- **Classes** — create classes, **assign a teacher**, set capacity, room, term and the
  recurring weekly timetable; add and remove students from the roster; generate dated
  sessions from the weekly pattern over any date range.
- **Change requests** — approve or reject what teachers submit, with a note back to them.
- **Database** — browse every table row-by-row and export any of them to CSV.
- Every mutation is written to an **audit log**, also browsable and exportable.

### Teacher

- **My schedule** — week-by-week view of their own sessions.
- **Check in to a class** — records that the teacher showed up, with a timestamp.
- **Check in students** — the register for a session, with PRESENT / LATE / ABSENT /
  EXCUSED per student, per-student notes, and "set everyone to…" for one-click marking.
- **Report absent** — mark ABSENT with a reason; it surfaces immediately in the admin
  console and in the student's own attendance record.
- **View students** — full roster including age, phone and emergency contact details.
- **Submit change requests** — schedule, room, roster, cancel-a-session or free-form.

### Student

- **Sign up** — anyone can self-register a student account from the login screen. The role
  is forced to STUDENT server-side, so a client cannot request a teacher or admin account.
- **Find a class** — search by class name, code, description **or teacher name**, filter
  by day of week, then select the class. Full classes put you on the waitlist.
- **Search teachers** — every teacher and the classes they run.
- **My schedule** — week-by-week timetable.
- **My classes** — details and teacher contact; drop a class.
- **My attendance** — every register taken, with attendance rate.

All three roles share a **My profile** page for their own contact and emergency details
and password.

## Design decisions worth knowing

**A "class" is the `Course` model.** `class` is a reserved word in TypeScript, so the
model is named `Course` throughout the code and API; the UI says "Class" everywhere.

**Only the server talks to Firestore.** The browser bundle uses Firebase for
analytics and nothing else, and `firestore.rules` denies client access outright.
Every authorization decision in this app is a server-side check, so a client with
direct database access would answer to none of them.

**Weekly slots vs. dated sessions.** A class has `ScheduleSlot` rows (the recurring
pattern, e.g. Mon+Wed 09:00–10:30) and `Session` rows (concrete dated meetings). Students
browse the pattern; attendance and teacher check-in attach to sessions. Admins generate
sessions from the pattern over a date range — re-running over an overlapping range is safe
and creates no duplicates.

**Absence reporting is attendance, not a separate table.** A reported absence is an
`Attendance` row with status `ABSENT` and a reason note. One source of truth, so a
student's record and the admin's absence count can never disagree.

**Schedule clash detection.** A student cannot select two classes whose weekly slots
overlap; the API names the class that clashes.

**Capacity.** Selecting a full class puts the student on the waitlist automatically.
Admins can override by explicitly adding someone as waitlisted.

**Dropping keeps history.** Dropping a class sets the enrollment to `DROPPED` rather than
deleting it, so past attendance still reads correctly.

**Password hashes never leave the server** — not through the API, not through the raw
table browser, not through CSV export.

**Authorization is enforced server-side on every route**, not just hidden in the UI:
role guards plus per-record ownership checks (a teacher can only reach sessions belonging
to classes they teach). Verified: cross-teacher access returns 404, teacher→admin returns 403.

## How the data model sits on Firestore

Each entity is a top-level collection: `users`, `courses`, `scheduleSlots`,
`sessions`, `enrollments`, `attendance`, `changeRequests`, `auditLogs`. Three
things a relational database did for free are explicit in `backend/src/db.ts`:

**Composite uniqueness is the document id.** An enrollment lives at
`enrollments/{studentId}__{courseId}`, an attendance mark at
`attendance/{sessionId}__{studentId}`, a session at
`sessions/{courseId}__{startsAtMillis}`. "One row per pair" becomes a property of
the store rather than a check in a handler, every upsert is a plain merging
write, and re-generating sessions over an overlapping range still cannot produce
a duplicate.

**Single-field uniqueness is a reservation collection.** A username, an email and
a class code are claimed in `uniqueKeys` inside a transaction before the document
is written, so two simultaneous sign-ups for the same username is impossible
rather than merely unlikely.

**Referential actions are code.** Firestore has no `ON DELETE CASCADE`, so
`deleteUser`, `deleteCourse` and `deleteSession` do the cascade and the set-null
fan-out by hand.

**List endpoints filter in memory.** Firestore cannot do substring search, OR
across fields, or ordering by a joined value — and the API offers all three. So
searching classes or users loads the candidate set and finishes the job in JS,
which is right at school scale and wrong at ten thousand students; see the note
at the end of [DEPLOY.md](DEPLOY.md) for what to do then. Queries that *are*
pushed down (a date range on sessions, paging the audit log) are single-field on
purpose, so no composite index has to be deployed before the app works.

## Deploying

See **[DEPLOY.md](DEPLOY.md)**. The short version: the SPA goes to Firebase
Hosting, the API goes to any container host with a service-account key, and the
two are wired together by `CORS_ORIGIN` on the API and `VITE_API_BASE_URL` in the
frontend build.

## Scripts

| Command                | What it does                                      |
| ---------------------- | ------------------------------------------------- |
| `npm run dev`          | API + web UI together, both watching              |
| `npm run emulator`     | Local Firestore, no credentials needed            |
| `npm run build`        | Typecheck the API, typecheck and bundle the UI    |
| `npm run typecheck`    | Both workspaces                                   |
| `npm run db:seed`      | Wipe and reload demo data                         |
| `npm run deploy:rules` | Push `firestore.rules` and the index definitions  |
| `npm run deploy:web`   | Build the SPA and upload it to Firebase Hosting   |
| `npm run deploy`       | Both of the above                                 |

## API surface

All routes are under `/api`. `POST /api/auth/login` returns a bearer token; send it as
`Authorization: Bearer <token>`.

- `auth` — `register` (public, students only), `login`, `me` (GET/PATCH)
- `admin` — `stats`, `users`, `courses`, `courses/:id/sessions`,
  `courses/:id/enrollments`, `sessions/:id`, `change-requests`, `schedule`, `tables`,
  `tables/:table`, `export/:table`, `audit`
- `teacher` — `classes`, `classes/:id/students`, `schedule`, `sessions/:id`,
  `sessions/:id/check-in`, `sessions/:id/attendance`, `change-requests`
- `student` — `catalog`, `teachers`, `classes`, `enrollments`, `schedule`, `attendance`
