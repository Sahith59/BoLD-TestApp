# BOLD Vulnerable Demo App

This is a deliberately vulnerable web application for testing BOLD against BOLA/IDOR behavior. It looks and behaves like a normal client portal during regular use, but selected authenticated API routes intentionally omit server-side ownership checks.

## Run

```bash
npm start
```

Open `http://localhost:3000`.

Seed accounts:

```text
maya@demo.test / password123
leo@demo.test / password123
admin@demo.test / admin123
```

## Intentional Test Targets

Normal UI routes only show the signed-in user's own records:

```text
GET /api/overview
POST /api/invoices
```

Deliberately vulnerable routes:

```text
GET /api/invoices/:id
PATCH /api/invoices/:id
GET /api/files/:id
GET /api/admin/users
```

Example IDOR/BOLA checks after signing in as `maya@demo.test`:

```bash
curl -i -b cookies.txt http://localhost:3000/api/invoices/inv_8101
curl -i -b cookies.txt http://localhost:3000/api/files/file_4401
curl -i -b cookies.txt http://localhost:3000/api/admin/users
```

Maya should not own `inv_8101` or `file_4401`, but those routes return data anyway. That is intentional for testing only.

## Google OAuth Setup

Create a `.env` file from `.env.example`, then fill in your Google OAuth values:

```bash
cp .env.example .env
```

For local testing, set these values:

```text
APP_ORIGIN=http://localhost:3000
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=replace-with-a-long-random-string
BOLD_INGEST_URL=https://bold-backend-tjmj.onrender.com/api/live/ingest
BOLD_INGEST_KEY=...
BOLD_OWNER_FIELDS=ownerId
```

This app reads environment variables directly. With modern Node, start it from `.env` like this:

```bash
npm run start:env
```

You can also load `.env` into your shell manually:

```bash
set -a
source .env
set +a
npm start
```

In Google Cloud Console, create an OAuth web client and add this authorized redirect URI:

```text
http://localhost:3000/auth/google/callback
```

When you deploy to Vercel, add the deployed callback too:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/auth/google/callback
```

Then set the same variables in Vercel, with `APP_ORIGIN` and `GOOGLE_REDIRECT_URI` using the Vercel URL.

Recommended Vercel environment variables:

```text
APP_ORIGIN=https://YOUR-VERCEL-DOMAIN.vercel.app
GOOGLE_REDIRECT_URI=https://YOUR-VERCEL-DOMAIN.vercel.app/auth/google/callback
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=generate-a-long-random-string
BOLD_INGEST_URL=https://bold-backend-tjmj.onrender.com/api/live/ingest
BOLD_INGEST_KEY=...
BOLD_OWNER_FIELDS=ownerId
```

## BoLD Live Monitor Wiring

The vulnerable invoice-by-ID route is wired to BoLD live monitoring through `lib/bold.js`.

Observed routes:

```text
GET /api/invoices/:id
PATCH /api/invoices/:id
```

The monitor sends metadata only: hashed caller identity, method, endpoint shape, object id, status code, and the response's declared `ownerId`. It does not send response bodies, cookies, tokens, or headers.
