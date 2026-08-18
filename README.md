# ✈️ Boys Weeb Trip 2026 — Trip Dashboard

A shared web dashboard for the Tokyo trip:

- **Anyone with the link** can view the itinerary + photos and suggest ideas (no login)
- **Crew PIN** (Aaron + Alex) additionally unlocks photo uploads on itinerary items
- **Admin PIN** (Ben) unlocks approve/reject on ideas, adding/removing items, and deleting photos
- `/api/export` is a public JSON feed of the approved itinerary — used to sync approvals back into Tripsy via Claude

No flight details or Airbnb locations are included anywhere in the app.

## Deploy to Vercel (one time, ~5 minutes)

1. **Install the Vercel CLI** (needs Node.js): `npm i -g vercel`
2. From this folder, run:
   ```
   vercel
   ```
   Log in when prompted, accept the defaults (it auto-detects Next.js).
3. **Add a Blob store** (photo + data storage):
   - Vercel dashboard → your new project → **Storage** tab → **Create Database** → **Blob** → connect it to the project. This auto-adds `BLOB_READ_WRITE_TOKEN`.
4. **Set the PINs**: project → **Settings → Environment Variables**, add:
   - `TRIP_PIN` — share this with Aaron + Alex
   - `ADMIN_PIN` — yours only
5. Deploy to production:
   ```
   vercel --prod
   ```
6. Share the URL. Done.

### Local dev (optional)

```
npm install
cp .env.example .env.local   # fill in PINs
npm run dev
```

Without a `BLOB_READ_WRITE_TOKEN`, local dev uses in-memory storage (resets on restart) and photo upload is disabled.

## Tripsy sync

Approved ideas land in the itinerary with `source: "idea"` and an `approvedAt` timestamp, all visible at:

```
https://<your-app>.vercel.app/api/export
```

Ask Claude to "sync the dashboard to Tripsy" — it reads that feed, diffs against the Tripsy trip, and creates any missing activities. This can also be set up as a daily scheduled task.

## Notes

- Sessions last 90 days per browser; the PIN entry is under "Have a PIN?" on the header.
- Photos: images only, 10 MB max each, stored in Vercel Blob (public URLs, unguessable).
- The idea queue caps at 100 pending items (light spam protection, plus a honeypot field).
