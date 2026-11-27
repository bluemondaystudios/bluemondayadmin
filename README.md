# Blue Monday Admin

*The blue admin. The mystic blues.*

The private quotes, invoicing and records app for Blue Monday Studios. It's an installable web app (PWA) at
**admin.bluemondaystudios.co.za**, built with React, Vite and TypeScript, with Supabase for sign-in, the database and
receipt storage. It started as a copy of EDRAM Admin (`bluemondaystudios/edramshuttleadmin`) and shares its design,
with quotes and deposit invoices added.

The decisions and how everything fits together are in [`CLAUDE.md`](CLAUDE.md).

> This repository is public. It must never contain client data, passwords or secret keys.

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase URL and publishable key
npm run dev
```

Without `.env.local` the app still starts, but the sign-in screen says it isn't connected to a database yet.

## Checks

| Command | What it does |
|---|---|
| `npm test` | Unit tests: money, dates and tax years, invoice and quote maths, deposits, filters, share text, the PDFs, CSV and ZIP exports, the offline expense queue |
| `npm run typecheck` | TypeScript strict-mode check |
| `npm run test:db` | Applies `supabase/migrations` to a throwaway PostgreSQL 16 database and runs `supabase/tests/db_tests.sql`. Needs `PGHOST`/`PGUSER`… pointing at a local Postgres, **never** at Supabase |
| `npm run build` | Production build into `dist/` |

GitHub Actions runs all of them on every pull request. On `main` it also deploys to GitHub Pages.

### Clicking through the app without Supabase

`e2e/` drives the app in headless Chromium against `e2e/fakeSupabase.cjs`, an in-memory stand-in that follows the same
rules as the database:

```bash
VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=demo npx vite build --outDir /tmp/bm-e2e
npx vite preview --outDir /tmp/bm-e2e --port 4173 &
node e2e/quotes.cjs /tmp/bm-screens     # quotes, deposit and balance invoices; ends with: E2E QUOTES PASSED
node e2e/flow.cjs /tmp/bm-screens       # invoices; ends with: E2E FLOW PASSED
node e2e/expenses.cjs /tmp/bm-screens   # expenses, incl. flight mode; ends with: E2E EXPENSES PASSED
node e2e/records.cjs /tmp/bm-screens    # reports, export pack, backup; ends with: E2E RECORDS PASSED
```

They need Playwright installed globally, so they aren't part of CI.

## Folders

- `src/`: the app (`brand.ts` names the business; `lib/` holds tested helpers; `features/` the screens; `ui/` shared pieces)
- `supabase/migrations/`: the database schema, with the business rules enforced in the database
- `supabase/tests/`: the database test kit
- `scripts/`: the database test runner
- `e2e/`: the headless click-throughs and the fake Supabase they run against
