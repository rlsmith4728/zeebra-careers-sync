# zeebra-careers-sync

Syncs job listings from the external jobs API into the Zeebra Webflow site's
`Careers` CMS collection, on a schedule via GitHub Actions.

## What it does

Each run:

1. Fetches `JOBS_API_URL` and the current Careers collection items.
2. Matches API records to CMS items by the `Source ID` field (not by title —
   titles like "Front-End Engineer" repeat across companies and can change).
3. Creates new items, updates changed ones, and un-archives any item whose
   job has reappeared in the feed.
4. **Archives** (does not delete) any previously-synced item whose job has
   dropped out of the feed — reversible from the CMS UI if that was a
   mistake.
5. Publishes everything it created/updated so it goes live immediately.

Manually-added Careers entries (no `Source ID`) are never touched.

## One-time setup

1. Push this repo to GitHub.
2. Create a Webflow API token with CMS read/write access for the site
   (Webflow Dashboard → Site settings → Apps & integrations → API access,
   or a Workspace-level token — see
   [Webflow's API token docs](https://developers.webflow.com/data/reference/authentication)).
   **Do not paste the token into chat with an AI assistant** — create it
   directly in the Webflow dashboard and copy it straight into the GitHub
   secret below.
3. In the GitHub repo, go to **Settings → Secrets and variables → Actions**:
   - Add a **secret** named `WEBFLOW_API_TOKEN` with that token.
   - Add a **variable** named `WEBFLOW_COLLECTION_ID` set to
     `6a8832a4562424c077c256ad` (the Careers collection on
     `robs-emea-zeebra-proj`).
4. Go to the **Actions** tab, select "Sync Careers CMS", and run it once
   manually (`Run workflow`) to confirm it works before trusting the
   schedule.

## Local testing

```bash
cp .env.example .env
# fill in WEBFLOW_API_TOKEN in .env
node --env-file=.env sync.js
```

## Adjusting the schedule

Edit the `cron` line in `.github/workflows/sync-careers.yml`. It currently
runs every 6 hours. Cron times are UTC and GitHub Actions schedules can lag
by several minutes under load — don't rely on this for time-sensitive
postings.
