# Writing Test Taker

A monitored IELTS-style writing test with a **separate, private teacher panel**.

- **Student page** (`/`) — enter name → fullscreen split-screen test (Task 1 = 20 min, Task 2 = 40 min). If the student switches tabs, opens another window/app, or leaves fullscreen, the test **ends instantly** and is reported to the teacher as **cheated**.
- **Teacher page** (`/teacher?key=…`) — set the two tasks (type text or drag-and-drop a chart image) and watch a **live results board** of who finished and who left the test early.

**Stack:** static HTML/CSS/JS + Vercel serverless functions (`/api`) + Supabase (Postgres). No build step, no npm dependencies.

---

## How students are kept out of the teacher side (3 layers)

1. **The teacher page itself is gated.** `/teacher` is served by a serverless function that returns the teacher UI **only when the secret key is in the link**. Without it, visitors get an "access denied" page — the teacher HTML is never sent to a student's browser.
2. **Every teacher API action re-checks the key server-side** (publish tasks, read results, clear results). No key → `403`.
3. **The database is locked to the server.** Supabase Row-Level Security is ON with no public policies, so only the server (using the secret `service_role` key, which never reaches any browser) can read or write. Students literally cannot query the database.

The teacher link and student link are therefore genuinely different, and the teacher link is the password — keep it private.

---

## Deploy it (Supabase + GitHub + Vercel)

### 1) Supabase — create the database
1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the contents of [`supabase.sql`](supabase.sql), and **Run**. This creates the `tasks` and `submissions` tables and locks them down.
3. Open **Project Settings → API keys** and copy two values:
   - **Project URL** → this is `SUPABASE_URL`
   - the **secret key** (starts with `sb_secret_`) → this is `SUPABASE_SECRET_KEY` (⚠️ secret — never put it in the frontend or commit it). The legacy `service_role` key also works.

### 2) GitHub — push the code
```bash
git add -A
git commit -m "Writing Test Taker"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
(`.gitignore` already excludes `.env` and the local `data/` folder, so no secrets are committed.)

### 3) Vercel — deploy
1. At [vercel.com](https://vercel.com) → **Add New → Project** → import your GitHub repo.
2. Framework preset: **Other** (no build command needed). Deploy.
3. In the project's **Settings → Environment Variables**, add these three, then **redeploy**:

   | Name | Value |
   |------|-------|
   | `SUPABASE_URL` | your Supabase Project URL |
   | `SUPABASE_SECRET_KEY` | your Supabase secret key (`sb_secret_…`) |
   | `TEACHER_KEY` | a long private string you choose |

### 4) Your two links
- **Student:** `https://your-app.vercel.app/`
- **Teacher:** `https://your-app.vercel.app/teacher?key=YOUR_TEACHER_KEY`

Give students only the first link. Keep the teacher link to yourself.

---

## Run it locally

```bash
node dev-server.js
```

With no Supabase env vars set, it uses a local `data/` folder so you can test everything offline. It prints both links (teacher key defaults to `wtt-teacher-4821` locally). To test against your real Supabase from your machine, copy `.env.example` to `.env`, fill it in, and load it before starting (e.g. `env $(cat .env | xargs) node dev-server.js`).

---

## Marking students' writing

While the exam is running students get **no help at all** — spellcheck, autocorrect, autocapitalise and Grammarly are all switched off on the exam page, so nothing underlines or "fixes" their mistakes as they write.

The marking only appears afterwards, and both sides can see it:

- **Teacher** — open **View essays** on any student in the live register.
- **Student** — press **Analyze my writing** on their own finished screen once the exam is over.

Either way the writing is shown **marked up like a red pen**:

- An **estimated IELTS band** at the top — an overall Writing band plus a breakdown of the four criteria (Task Response, Coherence & Cohesion, Lexical Resource, Grammar) and each task's band (Task 2 counts double, as in real IELTS).
- **Spelling** (red), **grammar** (gold), **punctuation** (blue) and **style** (grey) mistakes are underlined in the essay.
- A count at the top, e.g. *"18 issues — 14 spelling, 4 grammar"*.
- A correction list under each task: the exact words, the suggested fix, and why.
- A toggle for **American / British spelling**, plus **Re-check**.

### About the estimated band

The band is a **free, offline estimate** computed in [`lib/score.js`](lib/score.js) — no AI service, no API key, no cost. It has **no understanding of meaning**: it can't tell whether the essay actually answered the question, which is what a real examiner judges most. Instead it estimates each criterion from signals it *can* measure — length vs. the task minimum, grammar/spelling error density (reused from the LanguageTool check), vocabulary range, sentence variety and linking words. Treat it as a rough guide for students, **not an official score**; that's why the card says so. To make it smarter (real task-response judgement) you'd swap in an AI grader, which needs an API key and would send essays to that provider.

Checking is done by the free [LanguageTool](https://languagetool.org) API through `/api/check`. It is **not key-gated**, because students need it to review their own work after they submit — there's no way to use it during the exam, since the exam page has no checker and paste is blocked. Two things to know:

- **The essay text is sent to languagetool.org** to be checked. If that's not acceptable for your students' data, either remove the feature or [self-host LanguageTool](https://dev.languagetool.org/http-server) and point `LT_ENDPOINT` in `lib/handlers.js` at your own server.
- The free API is rate-limited (roughly 20 requests/minute). Checking a whole class very quickly may briefly fail — the essay is then shown unmarked with a notice, and **Re-check** retries.

## Notes & limits

- **A website cannot lock the whole laptop.** It can't block `Cmd/Alt+Tab`, `Cmd+Q`, or closing the browser — only native "kiosk" software can. So instead this **detects the moment a student leaves and ends the test**, flagging it to the teacher. That's the honest, browser-achievable version of lockdown.
- **Chart images**: keep them reasonably small (ideally under ~2–3 MB). Serverless requests have a ~4.5 MB body limit, and the image travels as base64 text in the database.
- **Teacher authentication** here is a secret link. If you'd prefer a proper email+password login (so the link can't be shared or leak), that's a straightforward upgrade to Supabase Auth — ask and it can be added.

## Files

```
index.html         student page (static)
student.js         student logic: timer, lockdown, cheat detection, submit
teacher-app.js     teacher dashboard logic (loaded by the gated teacher page)
styles.css         shared styles
api/tasks.js        GET tasks (public) / POST tasks (teacher key)
api/submissions.js  POST (student) / GET + DELETE (teacher key)
api/teacher.js      serves the teacher page ONLY with a valid key
lib/handlers.js    shared request handlers + the gated teacher HTML
lib/store.js       storage: Supabase in prod, local files in dev
dev-server.js      local-only dev server (not used on Vercel)
supabase.sql       database schema — run once in Supabase
vercel.json        routes /teacher -> the gated function
.env.example       the env vars you need
```
