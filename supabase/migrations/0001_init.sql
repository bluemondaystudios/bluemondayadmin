-- Blue Monday Admin: initial schema (Supabase / PostgreSQL)
-- Based on EDRAM Admin's schema, without vehicles, with quotes and deposit invoices.
-- Money is stored as integer cents (bigint). Never use floats for money.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Team: only users listed here can see or change anything
-- ---------------------------------------------------------------------------

create table public.team_members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

create or replace function public.is_team_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.team_members where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Business settings (single row) and the invoice counter (single row)
-- ---------------------------------------------------------------------------

create table public.business_settings (
  id                         smallint primary key default 1 check (id = 1),
  trading_name               text not null default 'Blue Monday Studios',
  legal_name                 text,
  entity_type                text check (entity_type in ('sole_proprietor', 'pty_ltd', 'other')),
  registration_no            text,
  income_tax_no              text,
  address                    text not null default 'Polokwane, Limpopo, South Africa',
  phone                      text not null default '081 403 5023',
  email                      text not null default 'info@bluemondaystudios.co.za',
  bank_name                  text,
  account_name               text,
  account_no                 text,
  branch_code                text,
  account_type               text,
  invoice_prefix             text not null default 'BMS-',
  quote_prefix               text not null default 'BMS-Q-',
  quote_valid_days           int  not null default 30 check (quote_valid_days between 1 and 365),
  default_deposit_percent    numeric(5, 2) not null default 50 check (default_deposit_percent > 0 and default_deposit_percent <= 100),
  quote_terms                text default 'The balance is due on completion, before the final files or site go live.',
  payment_terms_days         int  not null default 7 check (payment_terms_days >= 0),
  invoice_footer             text default 'Websites • Branding • Digital systems',
  financial_year_start_month smallint not null default 3 check (financial_year_start_month between 1 and 12),
  last_backup_at             timestamptz,
  updated_at                 timestamptz not null default now()
);
insert into public.business_settings default values;

-- Gap-free numbering: a counter row, not a sequence (sequences skip on rollback)
create table public.invoice_counter (
  id       smallint primary key default 1 check (id = 1),
  last_seq int not null default 0
);
insert into public.invoice_counter default values;

-- ---------------------------------------------------------------------------
-- Customers (shown as "Clients" in the app)
-- ---------------------------------------------------------------------------

create table public.customers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  contact_person text,
  phone          text,
  email          text,
  address        text,
  notes          text,
  archived       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- Quotes: numbered on creation (gaps are fine for quotes); frozen once sent
-- ---------------------------------------------------------------------------

create type public.quote_status as enum ('draft', 'sent', 'accepted', 'declined');

create sequence public.quote_seq;

create table public.quotes (
  id                uuid primary key default gen_random_uuid(),
  seq               int  unique,
  number            text unique,
  status            public.quote_status not null default 'draft',
  customer_id       uuid not null references public.customers (id),
  title             text,                 -- project name, e.g. 'Website for Mokoena Attorneys'
  notes             text,
  terms             text,                 -- payment terms printed on the quote
  deposit_percent   numeric(5, 2) not null default 50 check (deposit_percent > 0 and deposit_percent <= 100),
  total_cents       bigint not null default 0 check (total_cents >= 0),
  issue_date        date,                 -- set when sent
  valid_until       date,                 -- set when sent
  customer_snapshot jsonb,                -- set when sent
  seller_snapshot   jsonb,                -- set when sent
  sent_at           timestamptz,
  decided_at        timestamptz,          -- accepted or declined
  created_by        uuid default auth.uid() references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint sent_quote_has_details check (status = 'draft' or (issue_date is not null and valid_until is not null and sent_at is not null))
);

create table public.quote_lines (
  id               uuid primary key default gen_random_uuid(),
  quote_id         uuid not null references public.quotes (id) on delete cascade,
  position         smallint not null default 0,
  description      text not null,
  quantity         numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  amount_cents     bigint generated always as (round(quantity * unit_price_cents)::bigint) stored
);
create index on public.quote_lines (quote_id);

-- Numbers come from the database (a sequence, behind a security definer function)
create or replace function public.assign_quote_number()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prefix text;
begin
  select quote_prefix into v_prefix from public.business_settings where id = 1;
  new.seq := nextval('public.quote_seq');
  new.number := v_prefix || lpad(new.seq::text, 4, '0');
  if new.deposit_percent is null then
    select default_deposit_percent into new.deposit_percent from public.business_settings where id = 1;
  end if;
  return new;
end;
$$;

create trigger assign_quote_number before insert on public.quotes
  for each row execute function public.assign_quote_number();

-- Drafts are editable. Sending snapshots the client and business and freezes the contents.
-- After that only the status may change (sent, accepted, declined), never back to draft.
create or replace function public.guard_quote()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_settings public.business_settings;
  v_customer public.customers;
  changeable text[] := array['status', 'decided_at', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New quotes must start as drafts';
    end if;
    return new;
  end if;

  if new.seq is distinct from old.seq or new.number is distinct from old.number then
    raise exception 'Quote numbers cannot be changed';
  end if;

  if old.status = 'draft' then
    if new.status = 'draft' then
      return new;
    end if;
    if new.status <> 'sent' then
      raise exception 'Send the quote before marking it accepted or declined';
    end if;
    if not exists (select 1 from public.quote_lines where quote_id = old.id) then
      raise exception 'Add at least one line before sending the quote';
    end if;
    select * into v_settings from public.business_settings where id = 1;
    select * into v_customer from public.customers where id = new.customer_id;
    new.issue_date        := coalesce(new.issue_date, current_date);
    new.valid_until       := coalesce(new.valid_until, new.issue_date + v_settings.quote_valid_days);
    new.customer_snapshot := to_jsonb(v_customer);
    new.seller_snapshot   := to_jsonb(v_settings);
    new.sent_at           := now();
    new.total_cents       := (select coalesce(sum(amount_cents), 0) from public.quote_lines where quote_id = old.id);
    return new;
  end if;

  if new.status = 'draft' then
    raise exception 'Quote % has been sent: duplicate it to make changes.', old.number;
  end if;
  if (to_jsonb(new) - changeable) <> (to_jsonb(old) - changeable) then
    raise exception 'Quote % has been sent: its contents cannot be changed. Duplicate it to make changes.', old.number;
  end if;
  if new.status <> old.status then
    new.decided_at := case when new.status in ('accepted', 'declined') then now() else null end;
  end if;
  return new;
end;
$$;

create trigger guard_quote before insert or update on public.quotes
  for each row execute function public.guard_quote();

create or replace function public.guard_quote_lines()
returns trigger language plpgsql as $$
declare
  v_status public.quote_status;
begin
  select status into v_status from public.quotes where id = coalesce(new.quote_id, old.quote_id);
  -- v_status is null while a draft is being deleted (cascade)
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Lines of a sent quote cannot be changed';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_quote_lines before insert or update or delete on public.quote_lines
  for each row execute function public.guard_quote_lines();

create or replace function public.recalc_quote_total()
returns trigger language plpgsql as $$
begin
  update public.quotes q
  set total_cents = coalesce((select sum(amount_cents) from public.quote_lines l where l.quote_id = q.id), 0)
  where q.id = coalesce(new.quote_id, old.quote_id)
    and q.status = 'draft';
  return null;
end;
$$;

create trigger recalc_quote_total after insert or update or delete on public.quote_lines
  for each row execute function public.recalc_quote_total();

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

create type public.invoice_status as enum ('draft', 'issued', 'void');

create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  seq               int  unique,
  number            text unique,
  status            public.invoice_status not null default 'draft',
  customer_id       uuid not null references public.customers (id),
  quote_id          uuid references public.quotes (id),   -- set when invoiced from a quote
  kind              text not null default 'standard' check (kind in ('standard', 'deposit', 'balance')),
  customer_snapshot jsonb,   -- customer as it was when issued
  seller_snapshot   jsonb,   -- business details (incl. bank) as they were when issued
  issue_date        date,
  due_date          date,
  notes             text,
  total_cents       bigint not null default 0 check (total_cents >= 0),
  void_reason       text,
  voided_at         timestamptz,
  created_by        uuid default auth.uid() references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint invoice_number_matches_status check (
    (status = 'draft' and number is null and seq is null)
    or (status <> 'draft' and number is not null and seq is not null and issue_date is not null)
  ),
  constraint void_needs_reason check (status <> 'void' or (void_reason is not null and voided_at is not null))
);

create table public.invoice_lines (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references public.invoices (id) on delete cascade,
  position         smallint not null default 0,
  service_date     date,
  description      text not null,
  quantity         numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  amount_cents     bigint generated always as (round(quantity * unit_price_cents)::bigint) stored
);
create index on public.invoice_lines (invoice_id);

-- ---------------------------------------------------------------------------
-- Payments and expenses
-- ---------------------------------------------------------------------------

create type public.payment_method as enum ('eft', 'cash', 'card', 'other');

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id),
  paid_on      date not null default current_date,
  amount_cents bigint not null check (amount_cents > 0),
  method       public.payment_method not null default 'eft',
  reference    text,
  notes        text,
  created_by   uuid default auth.uid() references auth.users (id),
  created_at   timestamptz not null default now()
);
create index on public.payments (invoice_id);

create type public.expense_category as enum (
  'software', 'hosting_domains', 'equipment', 'internet_data', 'phone', 'travel',
  'contractors', 'advertising', 'printing', 'stock_assets', 'training', 'office', 'bank_fees', 'other'
);

create table public.expenses (
  id             uuid primary key default gen_random_uuid(),
  spent_on       date not null default current_date,
  amount_cents   bigint not null check (amount_cents > 0),
  category       public.expense_category not null,
  supplier       text,
  description    text,
  payment_method public.payment_method not null default 'card',
  receipt_path   text,          -- path in the private 'receipts' storage bucket
  deleted_at     timestamptz,   -- soft delete only: records are kept
  created_by     uuid default auth.uid() references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.expenses (spent_on);

-- ---------------------------------------------------------------------------
-- Audit log: every change to financial records is kept
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     text,
  action     text not null,
  old_row    jsonb,
  new_row    jsonb,
  actor      uuid default auth.uid(),
  at         timestamptz not null default now()
);

create or replace function public.write_audit_log()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_log (table_name, row_id, action, old_row, new_row)
  values (
    tg_table_name,
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
    tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return null;
end;
$$;

create trigger audit after insert or update or delete on public.business_settings for each row execute function public.write_audit_log();
create trigger audit after insert or update or delete on public.customers         for each row execute function public.write_audit_log();
create trigger audit after insert or update or delete on public.invoices          for each row execute function public.write_audit_log();
create trigger audit after insert or update or delete on public.invoice_lines     for each row execute function public.write_audit_log();
create trigger audit after insert or update or delete on public.payments          for each row execute function public.write_audit_log();
create trigger audit after insert or update or delete on public.expenses          for each row execute function public.write_audit_log();
create trigger audit after insert or update or delete on public.quotes            for each row execute function public.write_audit_log();
create trigger audit after insert or update or delete on public.quote_lines       for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- Integrity rules
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.business_settings for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.customers         for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.invoices          for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.expenses          for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.quotes            for each row execute function public.set_updated_at();

-- Invoices: new rows are drafts; only issue_invoice() may issue; only void_invoice() may void
create or replace function public.guard_invoice()
returns trigger language plpgsql as $$
declare
  frozen text[] := array['status', 'void_reason', 'voided_at', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New invoices must start as drafts';
    end if;
    if new.quote_id is not null and not exists (select 1 from public.quotes where id = new.quote_id and status = 'accepted') then
      raise exception 'Only an accepted quote can be invoiced';
    end if;
    return new;
  end if;

  if old.status = 'draft' then
    if new.quote_id is not null and new.quote_id is distinct from old.quote_id
       and not exists (select 1 from public.quotes where id = new.quote_id and status = 'accepted') then
      raise exception 'Only an accepted quote can be invoiced';
    end if;
    if new.status = 'issued' and coalesce(current_setting('bm.issuing', true), '') <> 'on' then
      raise exception 'Use issue_invoice() to issue an invoice';
    end if;
    if new.status = 'void' then
      raise exception 'Delete a draft instead of voiding it';
    end if;
    return new;
  end if;

  if old.status = 'issued'
     and new.status = 'void'
     and coalesce(current_setting('bm.voiding', true), '') = 'on'
     and (to_jsonb(new) - frozen) = (to_jsonb(old) - frozen) then
    return new;
  end if;

  raise exception 'Invoice % is %: it cannot be changed. Void it and issue a new one.', old.number, old.status;
end;
$$;

create trigger guard_invoice before insert or update on public.invoices
  for each row execute function public.guard_invoice();

-- Lines can only change while their invoice is a draft
create or replace function public.guard_invoice_lines()
returns trigger language plpgsql as $$
declare
  v_status public.invoice_status;
begin
  select status into v_status from public.invoices
  where id = coalesce(new.invoice_id, old.invoice_id);

  -- v_status is null while a draft is being deleted (cascade)
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Lines of an issued or void invoice cannot be changed';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_invoice_lines before insert or update or delete on public.invoice_lines
  for each row execute function public.guard_invoice_lines();

-- Keep invoices.total_cents equal to the sum of its lines
create or replace function public.recalc_invoice_total()
returns trigger language plpgsql as $$
begin
  update public.invoices i
  set total_cents = coalesce((select sum(amount_cents) from public.invoice_lines l where l.invoice_id = i.id), 0)
  where i.id = coalesce(new.invoice_id, old.invoice_id)
    and i.status = 'draft';
  return null;
end;
$$;

create trigger recalc_invoice_total after insert or update or delete on public.invoice_lines
  for each row execute function public.recalc_invoice_total();

-- Payments only against issued invoices
create or replace function public.guard_payment()
returns trigger language plpgsql as $$
declare
  v_status public.invoice_status;
begin
  select status into v_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status <> 'issued' then
    raise exception 'Payments can only be recorded against issued invoices';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_payment before insert or update or delete on public.payments
  for each row execute function public.guard_payment();

-- ---------------------------------------------------------------------------
-- Actions (called from the app with supabase.rpc)
-- ---------------------------------------------------------------------------

create or replace function public.issue_invoice(p_invoice_id uuid, p_issue_date date default current_date)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare
  v_inv      public.invoices;
  v_settings public.business_settings;
  v_customer public.customers;
  v_seq      int;
begin
  if not public.is_team_member() then
    raise exception 'Not allowed';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'Only drafts can be issued';
  end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = p_invoice_id) then
    raise exception 'Add at least one line before issuing';
  end if;

  select * into v_settings from public.business_settings where id = 1;
  select * into v_customer from public.customers where id = v_inv.customer_id;

  update public.invoice_counter set last_seq = last_seq + 1 where id = 1
  returning last_seq into v_seq;

  perform set_config('bm.issuing', 'on', true);

  update public.invoices
  set status            = 'issued',
      seq               = v_seq,
      number            = v_settings.invoice_prefix || lpad(v_seq::text, 4, '0'),
      issue_date        = p_issue_date,
      due_date          = p_issue_date + v_settings.payment_terms_days,
      customer_snapshot = to_jsonb(v_customer),
      seller_snapshot   = to_jsonb(v_settings),
      total_cents       = (select coalesce(sum(amount_cents), 0) from public.invoice_lines where invoice_id = p_invoice_id)
  where id = p_invoice_id
  returning * into v_inv;

  perform set_config('bm.issuing', 'off', true);
  return v_inv;
end;
$$;

create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare
  v_inv public.invoices;
begin
  if not public.is_team_member() then
    raise exception 'Not allowed';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to void an invoice';
  end if;
  if exists (select 1 from public.payments where invoice_id = p_invoice_id) then
    raise exception 'This invoice has payments recorded. Remove them before voiding.';
  end if;

  perform set_config('bm.voiding', 'on', true);

  update public.invoices
  set status = 'void', void_reason = btrim(p_reason), voided_at = now()
  where id = p_invoice_id and status = 'issued'
  returning * into v_inv;

  -- Check before any PERFORM: PERFORM resets FOUND
  if not found then
    raise exception 'Only issued invoices can be voided';
  end if;

  perform set_config('bm.voiding', 'off', true);
  return v_inv;
end;
$$;

revoke execute on function public.issue_invoice(uuid, date) from public, anon;
revoke execute on function public.void_invoice(uuid, text)  from public, anon;
grant  execute on function public.issue_invoice(uuid, date) to authenticated;
grant  execute on function public.void_invoice(uuid, text)  to authenticated;

-- ---------------------------------------------------------------------------
-- Views (security_invoker so RLS applies to whoever queries them)
-- ---------------------------------------------------------------------------

create view public.invoice_balances with (security_invoker = true) as
select
  i.id,
  i.number,
  i.status,
  i.customer_id,
  coalesce(i.customer_snapshot ->> 'name', c.name) as customer_name,
  i.issue_date,
  i.due_date,
  i.total_cents,
  coalesce(p.paid_cents, 0)                 as paid_cents,
  i.total_cents - coalesce(p.paid_cents, 0) as balance_cents,
  (i.status = 'issued'
   and i.total_cents - coalesce(p.paid_cents, 0) > 0
   and i.due_date < current_date)           as is_overdue,
  i.quote_id,
  i.kind
from public.invoices i
join public.customers c on c.id = i.customer_id
left join (
  select invoice_id, sum(amount_cents) as paid_cents from public.payments group by invoice_id
) p on p.invoice_id = i.id;

-- Money in (payments received) and money out (expenses), one row per entry
create view public.ledger with (security_invoker = true) as
select
  p.paid_on                        as entry_date,
  'income'::text                   as kind,
  p.amount_cents,
  i.number                         as reference,
  i.customer_snapshot ->> 'name'   as party,
  'payment'::text                  as category,
  p.method::text                   as method,
  null::text                       as receipt_path,
  p.id                             as source_id
from public.payments p
join public.invoices i on i.id = p.invoice_id
union all
select
  e.spent_on,
  'expense',
  e.amount_cents,
  null,
  e.supplier,
  e.category::text,
  e.payment_method::text,
  e.receipt_path,
  e.id
from public.expenses e
where e.deleted_at is null;

-- Per quote: how much has been invoiced (issued, not void) and paid so far
create view public.quote_progress with (security_invoker = true) as
select
  q.id,
  q.number,
  q.status,
  q.customer_id,
  coalesce(q.customer_snapshot ->> 'name', c.name) as customer_name,
  q.title,
  q.issue_date,
  q.valid_until,
  q.total_cents,
  q.deposit_percent,
  coalesce(inv.invoiced_cents, 0)                 as invoiced_cents,
  coalesce(inv.paid_cents, 0)                     as paid_cents,
  q.total_cents - coalesce(inv.invoiced_cents, 0) as left_to_invoice_cents,
  coalesce(inv.draft_count, 0)                    as draft_invoice_count,
  (q.status = 'sent' and q.valid_until < current_date) as is_expired
from public.quotes q
join public.customers c on c.id = q.customer_id
left join (
  select
    i.quote_id,
    sum(i.total_cents) filter (where i.status = 'issued') as invoiced_cents,
    sum(coalesce(p.paid, 0)) filter (where i.status = 'issued') as paid_cents,
    count(*) filter (where i.status = 'draft') as draft_count
  from public.invoices i
  left join (select invoice_id, sum(amount_cents) as paid from public.payments group by invoice_id) p on p.invoice_id = i.id
  where i.quote_id is not null
  group by i.quote_id
) inv on inv.quote_id = q.id;

-- ---------------------------------------------------------------------------
-- Row Level Security: team members only; nothing for anyone else
-- ---------------------------------------------------------------------------

alter table public.team_members      enable row level security;
alter table public.business_settings enable row level security;
alter table public.invoice_counter   enable row level security;  -- no policies: only issue_invoice() touches it
alter table public.customers         enable row level security;
alter table public.invoices          enable row level security;
alter table public.invoice_lines     enable row level security;
alter table public.payments          enable row level security;
alter table public.expenses          enable row level security;
alter table public.audit_log         enable row level security;
alter table public.quotes            enable row level security;
alter table public.quote_lines       enable row level security;

create policy team_read   on public.team_members      for select to authenticated using (public.is_team_member());

create policy team_read   on public.business_settings for select to authenticated using (public.is_team_member());
create policy team_update on public.business_settings for update to authenticated using (public.is_team_member()) with check (public.is_team_member());

create policy team_all    on public.customers         for all    to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy team_all    on public.invoice_lines     for all    to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy team_all    on public.payments          for all    to authenticated using (public.is_team_member()) with check (public.is_team_member());

create policy team_read   on public.invoices          for select to authenticated using (public.is_team_member());
create policy team_insert on public.invoices          for insert to authenticated with check (public.is_team_member());
create policy team_update on public.invoices          for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy team_delete_drafts on public.invoices   for delete to authenticated using (public.is_team_member() and status = 'draft');

-- Expenses: no delete policy, so rows are soft-deleted with deleted_at
create policy team_read   on public.expenses          for select to authenticated using (public.is_team_member());
create policy team_insert on public.expenses          for insert to authenticated with check (public.is_team_member());
create policy team_update on public.expenses          for update to authenticated using (public.is_team_member()) with check (public.is_team_member());

create policy team_read   on public.audit_log         for select to authenticated using (public.is_team_member());

create policy team_read   on public.quotes            for select to authenticated using (public.is_team_member());
create policy team_insert on public.quotes            for insert to authenticated with check (public.is_team_member());
create policy team_update on public.quotes            for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy team_delete_drafts on public.quotes     for delete to authenticated using (public.is_team_member() and status = 'draft');
create policy team_all    on public.quote_lines       for all    to authenticated using (public.is_team_member()) with check (public.is_team_member());

-- ---------------------------------------------------------------------------
-- Table rights for signed-in users
-- New Supabase projects don't open tables to the API roles automatically.
-- These grants say WHICH operations a signed-in user may attempt; the RLS
-- policies above decide WHOSE rows (team members only). Anonymous: nothing.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant execute on function public.is_team_member() to authenticated;
revoke execute on function public.is_team_member() from anon;

grant select                         on public.team_members      to authenticated;
grant select, update                 on public.business_settings to authenticated;
grant select, insert, update, delete on public.customers         to authenticated;
grant select, insert, update, delete on public.quotes            to authenticated;  -- delete: drafts only (policy)
grant select, insert, update, delete on public.quote_lines       to authenticated;  -- changes: drafts only (trigger)
grant select, insert, update, delete on public.invoices          to authenticated;  -- delete: drafts only (policy)
grant select, insert, update, delete on public.invoice_lines     to authenticated;  -- changes: drafts only (trigger)
grant select, insert, update, delete on public.payments          to authenticated;  -- issued invoices only (trigger)
grant select, insert, update         on public.expenses          to authenticated;  -- no delete: soft delete only
grant select                         on public.audit_log         to authenticated;  -- written only by triggers
grant select                         on public.invoice_balances  to authenticated;
grant select                         on public.quote_progress    to authenticated;
grant select                         on public.ledger            to authenticated;
-- invoice_counter and quote_seq: deliberately no grants; only the database functions use them

-- ---------------------------------------------------------------------------
-- Storage: private bucket for receipt photos
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false);

create policy receipts_read   on storage.objects for select to authenticated using (bucket_id = 'receipts' and public.is_team_member());
create policy receipts_insert on storage.objects for insert to authenticated with check (bucket_id = 'receipts' and public.is_team_member());
create policy receipts_update on storage.objects for update to authenticated using (bucket_id = 'receipts' and public.is_team_member());
-- No delete policy: receipts are records and are kept
