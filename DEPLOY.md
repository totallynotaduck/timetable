# Deploy to GitHub Pages (static front-end) + Vercel (account API)

GitHub Pages can only serve **static files** — it cannot run the Node `api/` functions.
So the app is split:

- **GitHub Pages** → hosts the static `index.html` (the account UI + timetable).
- **Vercel** → hosts the `api/` serverless functions + Upstash Redis (the online DB that syncs across devices).

The static site calls the API using the `API` base URL defined near the top of
`index.html`. Set it to your deployed Vercel URL (or via a `meta[name="api-base"]` tag).

## 1. Create the online database (Upstash Redis)
1. Go to https://upstash.com → **Create Database** (free).
2. Copy the **REST URL** and **REST Token**.

## 2. Deploy the API to Vercel
1. `npm install` (installs `@upstash/redis` + `bcryptjs`).
2. `vercel env add UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   (paste the values from step 1). Also add `NODE_ENV=production`.
3. `vercel --prod` to deploy.
4. Note your API URL, e.g. `https://timetable-api.vercel.app`.

## 3. Point the front-end at the API
In `index.html`, change the `API` constant near the top of the `<script>`:
```js
const API = 'https://timetable-api.vercel.app';
```
(Or leave it and add `<meta name="api-base" content="https://...">` in `<head>`.)

## 4. Deploy the static site to GitHub Pages
1. Push this repo to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Choose branch `main` (or `gh-pages`) and folder **`/ (root)`**, then **Save**.
4. Wait for the Action to finish. Your app is live at
   `https://<user>.github.io/<repo>/`.

> The `.nojekyll` file is included so GitHub Pages does not ignore the `api/` folder.

## 5. Cross-device sync
Open the GitHub Pages URL on any device, **register** once, then **log in** everywhere.
Events are saved per-account in Upstash Redis and loaded automatically on each device,
so they stay in sync.
