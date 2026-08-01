# Giggles Per Drink (GPD)

A live party tab: `GPD = Total Giggle Score ÷ Total Drink Units`. No login, no accounts — just names.

## What's inside

- **Backend:** Express + SQLite (`better-sqlite3`), one file (`server.js`), zero external services.
- **Frontend:** a single static page (`public/index.html`) — vanilla JS, polls every 3s for live sync, no build step.
- **Data persists** in `gpd.db` (SQLite file) next to the server. On most host platforms this resets on redeploy unless you attach a persistent volume (see below) — fine for a single party, but attach a volume if you want the leaderboard to survive across deploys.

## Run it locally

```bash
npm install
npm start
```
Open `http://localhost:3000`. Open it on a second device on the same wifi at `http://<your-computer's-LAN-IP>:3000` to test multi-device sync.

## Deploy it for real (so friends can join from their phones)

Any Node host works. Two easy, free-tier-friendly options:

### Option A — Railway (recommended, ~2 min)
1. Push this folder to a new GitHub repo (or use `railway up` directly from the folder with the [Railway CLI](https://docs.railway.com/guides/cli)).
2. At [railway.app](https://railway.app), "New Project" → "Deploy from GitHub repo" (or run `railway up` in this folder).
3. Railway auto-detects Node, runs `npm install` then `npm start`. It assigns a public URL automatically.
4. **Attach a volume** (Settings → Volumes) mounted at `/app` (or wherever `gpd.db` lands) if you want history to survive redeploys.

### Option B — Render
1. Push to GitHub, then at [render.com](https://render.com) → "New Web Service" → connect the repo.
2. Build command: `npm install`. Start command: `npm start`.
3. Add a persistent disk mounted at the project root if you want data to survive redeploys.

Both give you a real `https://...` URL — that's the link you text to the group.

## How it works

- Everyone starts by typing a name (no password). Returning users type the same name to resume their profile — an avatar is deterministically assigned from the name.
- One person **starts a tab** → becomes Owner, gets a 4-character room code to read aloud.
- Everyone else **joins the tab** with that code → becomes a Friend.
- Owner sees only drink-logging buttons (Beer / Wine / Cocktail / Shot). Friends see only giggle-logging buttons (Chuckle → Legendary).
- All connected devices poll the room every 3 seconds, so the GPD, live ranking, and stats stay in sync across every phone within a few seconds.
- **Owner closes the tab** → the night gets archived to the all-time "Best Nights" leaderboard, and every participating friend's lifetime points/nights-played/best-night get credited to their persistent profile.
- Leaving a tab just stops watching it — it keeps running until the Owner closes it out. Refreshing mid-session rejoins the same room automatically (stored in `localStorage`).

## Notes / edge cases handled

- Joining a room code that doesn't exist → clear error, no crash.
- Owner closing a tab while friends are still in it → friends' next poll detects `status: closed` and gets bounced to Home with a toast.
- Refreshing mid-session → name and room code are cached in `localStorage`, so you're dropped right back into the same tab as the same person.
- Room codes are 4 characters from an unambiguous alphabet (no `0/O/1/I`) so they're easy to read aloud in a loud bar.
