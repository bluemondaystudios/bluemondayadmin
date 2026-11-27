# Blue Monday Admin: build context

The private records, quoting and invoicing system for **Blue Monday Studios**, at **admin.bluemondaystudios.co.za**.
It is a copy of **EDRAM Admin** (`bluemondaystudios/edramshuttleadmin`, whose `CLAUDE.md` has the full original
specification), adapted for a studio: no vehicles, studio services and expense categories, and **quotes with deposit
and balance invoices**. Build from this file; don't reopen the decisions unless the developer asks.

## 1. The business and the people

- **Business:** Blue Monday Studios, Polokwane, Limpopo, South Africa · 081 403 5023 · info@bluemondaystudios.co.za.
  Services: websites, Google Business profiles, WhatsApp Business, business email, graphic design, digital systems.
- **Users:** exactly two (the owner/developer and one other team member). Sign-ups disabled.
- **Public website:** https://bluemondaystudios.co.za, from repo `bluemondaystudios/blue-monday-studios` (React + Vite).
- **Why it exists:** invoices were being drafted in a chat assistant, which isn't a safe place for client and banking
  details. Records now live only in the business's own Supabase project.

## 2. Decisions

| Decision | Choice |
|---|---|
| VAT | **Not VAT-registered.** Documents say **INVOICE** / **QUOTE**, never "Tax Invoice"; no VAT anywhere |
| Quotes | Numbered by the database on creation (`BMS-Q-0001`, gaps allowed). Editable while draft; **sending freezes them** and snapshots client and business details; then only the answer changes (sent → accepted/declined, never back to draft). Revise by duplicating |
| Deposits | An **accepted** quote can be invoiced as a deposit (default 50%, set per quote), the balance, or in full. Each is a normal invoice (gap-free `BMS-0001` number, frozen once issued, void with reason) linked by `invoices.quote_id` and `kind` (`standard`, `deposit`, `balance`). The database refuses invoices for quotes that aren't accepted |
| Invoices, payments, expenses, records | Exactly as EDRAM Admin: gap-free numbers, frozen issued invoices, void with reason, payments only on issued invoices, soft-deleted expenses, receipts never deleted, audit log, tax-year export pack, backup |
| Vehicles | **None** (removed from schema and app) |
| Hosting | GitHub Pages via Actions; Supabase free tier (separate project from EDRAM, in Blue Monday's name) |
| Data in the repo | Never. The repo is public; the Supabase URL and publishable key are public by design; RLS protects data |
| Branding | All names in `src/brand.ts`; colours in `src/styles/tokens.css` (navy `#071B3A`, yellow `#FFD33D`, paper `#F4F7FB`, ink `#101A2B`, muted `#647086`; Paid stays green `#2F855A`); fonts Space Grotesk (headings) and DM Sans (text); BM logo from the website |

## 3. Stack and layout

Same as EDRAM Admin: React (stable), Vite, TypeScript strict, React Router **hash router**, supabase-js v2 with PKCE,
TanStack Query, react-hook-form + zod, jsPDF + jspdf-autotable (PDFs built on the phone), fflate (ZIP exports),
vite-plugin-pwa, idb-keyval (offline expense queue), plain CSS with custom properties, Vitest.

```
src/brand.ts                      ← business names, file prefixes
src/lib/pdf/documentPdf.ts        ← shared A4 layout; invoicePdf.ts and quotePdf.ts fill it in
src/lib/quoteMath.ts              ← deposit / balance / full invoicing from a quote (tested)
src/lib/quotesApi.ts, api.ts      ← Supabase reads/writes (TanStack Query hooks)
src/features/quotes/              ← list, editor, detail, statuses
src/features/invoices|customers|expenses|reports|backup|settings/
supabase/migrations/0001_init.sql ← the whole schema, including grants (one file for a fresh project)
supabase/tests/                   ← stub (no default grants, like new Supabase projects) + db_tests.sql
e2e/                              ← headless click-throughs against a fake Supabase
```

## 4. Data model (see `supabase/migrations/0001_init.sql`)

Money is integer cents. Tables: `team_members`, `business_settings` (single row; adds `quote_prefix` `BMS-Q-`,
`quote_valid_days` 30, `default_deposit_percent` 50, `quote_terms`), `invoice_counter` (hidden), `customers` (shown as
"Clients"), `quotes`, `quote_lines`, `invoices` (+ `quote_id`, `kind`), `invoice_lines`, `payments`, `expenses`
(studio categories: software, hosting_domains, equipment, internet_data, phone, travel, contractors, advertising,
printing, stock_assets, training, office, bank_fees, other), `audit_log` (quotes included).

Views (security_invoker): `invoice_balances` (+ `quote_id`, `kind`), `ledger`, and `quote_progress` (per quote:
invoiced and paid on issued invoices, left to invoice, draft invoice count, expired).

Rules in the database: quote numbering (security definer + private sequence), quote freezing and snapshots on send,
totals recalculated from lines when a quote is sent and when an invoice is issued, "only accepted quotes can be
invoiced", plus every EDRAM rule. **Grants are in the same file**: new Supabase projects don't open tables to the API
roles, so `authenticated` gets exactly what the app needs and `anon` nothing. Add grants for any new table or view.

## 5. App

- **Phone tabs:** Home · Quotes · ＋ · Invoices · More. ＋ offers New quote, New invoice, Log expense, Record payment.
  **Expenses** live under More (and in the left rail on screens ≥ 900px).
- **Home:** four tiles (received this month, outstanding, overdue, expenses this month), the backup reminder, quotes to
  follow up (sent, or accepted but not yet invoiced), recent invoices.
- **Quote detail:** Share (PDF via the phone's share sheet, or download + WhatsApp link), Accepted / Declined,
  then *Invoice the deposit* / *Invoice the full amount*, later *Invoice the balance*; each makes a draft invoice to
  check and issue. Shows invoiced vs left to invoice and the linked invoices. Duplicate to revise.
- **Quote PDF:** QUOTE, number, date, valid until, project title, lines, total, deposit, payment-terms box, ACCEPTED
  stamp or DECLINED watermark. **Invoice PDF:** as EDRAM, plus "Deposit/Balance invoice for quote BMS-Q-0001".

## 6. Setup (developer)

1. **Supabase:** new free project in Blue Monday's name. Auth → Sign In / Providers: Email on, **sign-ups off**. Add the
   two users. URL configuration: Site URL `https://admin.bluemondaystudios.co.za`.
2. **Database:** SQL editor → run `supabase/migrations/0001_init.sql` once. Then
   `insert into public.team_members (user_id, display_name) select id, email from auth.users;`
   Never run `supabase/tests/*` against the real project.
3. **GitHub:** Settings → Pages → Source: **GitHub Actions**; Custom domain `admin.bluemondaystudios.co.za`; Enforce
   HTTPS. Actions **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable/anon key only).
4. **DNS:** CNAME `admin` → `bluemondaystudios.github.io`. **Verify `bluemondaystudios.co.za` in GitHub** (account
   Settings → Pages → Add a domain) first: the zone has a wildcard `*` record, so an unverified subdomain could be
   claimed by another GitHub user.
5. In the app: More → Settings for bank details, business type and registration number (never via chat).

**CI** (`.github/workflows/deploy.yml`): typecheck, Vitest, DB tests on Postgres 16 (every migration, must print
`ALL TESTS PASSED`), build; deploy to Pages on `main`.

## 7. Working conventions with this developer

- Work on a feature branch; commit with clear messages; push. Open a PR and merge only when the developer asks.
- Before pushing: unit tests, DB tests, the e2e click-throughs, and screenshots at phone (390×844) and desktop
  (1366×768) sizes, sent to the developer.
- Explain in plain language. Keep secrets, client details and bank details out of chat, the repo and logs.
