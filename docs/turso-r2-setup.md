# Turso + Cloudflare R2 Setup

This app should use Turso for database records and Cloudflare R2 for large files.

## 1. Create Turso

If Turso is available in your Vercel Marketplace, the simplest path is:

```bash
vercel integration add turso
vercel env pull .env.local --yes
```

Run these in WSL or another shell that has the Turso CLI:

```bash
curl -sSfL https://get.tur.so/install.sh | sh
turso auth signup
turso db create tradingbot
turso db show --url tradingbot
turso db tokens create tradingbot
```

Save the database URL and token as:

```text
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

## 2. Create Cloudflare R2

Create an R2 bucket named:

```text
tradingbot-data
```

Create an R2 API token with Object Read and Write access for that bucket. Use the S3 endpoint format from Cloudflare:

```text
R2_BUCKET=tradingbot-data
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

Optional:

```text
R2_PREFIX=prod
```

## 3. Add Local Env

Add the values to `.env.local`. Do not commit secrets.

Then verify:

```bash
npm run storage:check
npm run turso:migrate
```

## 4. Add Vercel Env

Add each value for Production, Preview, and Development:

```bash
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel env add R2_BUCKET production
vercel env add R2_ENDPOINT production
vercel env add R2_ACCESS_KEY_ID production
vercel env add R2_SECRET_ACCESS_KEY production
```

Repeat for `preview` and `development`, or use the Vercel dashboard.

After changing Vercel env vars, pull them locally:

```bash
vercel env pull .env.local --yes
```

## 5. Migration Order

1. Run `npm run storage:check`.
2. Run `npm run turso:migrate`.
3. Copy Firestore collections into `app_documents`:

```bash
npm run storage:migrate -- --firestore-only
```

4. Copy local storage objects into R2:

```bash
npm run r2:sync -- --changed-only --roots=cache,config,data,strategy
```

If Firebase Storage billing is healthy and you prefer copying from Firebase Storage instead:

```bash
npm run storage:migrate -- --storage-only --changed-only --storage-roots=cache,config,data,strategy
```

Use `--storage-roots=Research` as a separate run if you want the research artifacts in R2 too.

5. Switch reads to Turso/R2 with Firebase fallback.
6. After verification, switch writes to Turso/R2.
