# Deploy — GitHub Pages only + Upstash Redis (no server needed)

The app runs **entirely as a static site** on GitHub Pages. It talks directly to
**Upstash Redis REST** (which is CORS-enabled), so there is no backend to deploy.
Your timetable syncs across every device that logs in with the same username.

## 1. Create the online database (free)
1. Go to https://upstash.com → sign up → **Create Database**.
2. Open the database → **REST API** section.
3. Copy the **REST URL** (e.g. `https://xxx.upstash.io`) and the **REST Token**
   (starts with `Axp_` or similar).

## 2. Deploy the static site to GitHub Pages
1. Push this repo to GitHub (it is already pushed to `totallynotaduck/timetable`).
2. Repo **Settings → Pages → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Your app is live at `https://<user>.github.io/<repo>/`.

> `.nojekyll` is included so GitHub Pages serves everything as-is.

## 3. Connect the app to the database (in the browser)
1. Open the live URL. Click **⚙ 数据库设置（Upstash）**.
2. Paste the **REST URL** and **REST Token**, save. The page reloads.
3. **Register** a username + password (stored hashed in Upstash).
4. On any other device, open the same URL, enter the **same Upstash URL + Token**,
   and **log in** with the same username. Your timetable is now synced.

The Upstash URL/Token are stored in the browser's `localStorage` (per device).
They are sent directly to Upstash over HTTPS — no middle server sees them.

## Security note
Because the Upstash token lives in client-side JS, anyone with the page + token can
read/write that Redis DB. This is fine for a **personal** timetable. For stronger
isolation you could scope the token or add a Vercel proxy (see git history: the old
`api/` serverless backend). Passwords are still hashed with bcrypt before storage.
