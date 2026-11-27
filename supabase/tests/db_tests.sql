\set ON_ERROR_STOP 1
\set QUIET 1
create function pg_temp.expect_error(q text, pat text) returns void language plpgsql as $f$
begin
  execute q;
  raise exception 'EXPECTED ERROR NOT RAISED: %', q;
exception when others then
  if sqlerrm like 'EXPECTED ERROR NOT RAISED%' then raise; end if;
  if sqlerrm !~* pat then raise exception 'Wrong error for [%]: %', q, sqlerrm; end if;
  raise notice 'ok, refused: %', left(sqlerrm, 90);
end $f$;
grant execute on function pg_temp.expect_error(text, text) to anon, authenticated;

-- Users: A and B are the team, X is a signed-in stranger
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'dev@example.com'),
  ('00000000-0000-0000-0000-0000000000ff', 'stranger@example.com');
insert into public.team_members values
  ('00000000-0000-0000-0000-00000000000a', 'Owner'),
  ('00000000-0000-0000-0000-00000000000b', 'Developer');

-- ===== As team member A =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

insert into customers (id, name, phone) values ('c0000000-0000-0000-0000-000000000001', 'Mokoena Family', '082 000 0000');
insert into invoices  (id, customer_id) values ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001');
insert into invoices  (id, customer_id) values ('10000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001');
insert into invoice_lines (invoice_id, position, description, quantity, unit_price_cents) values
  ('10000000-0000-0000-0000-000000000001', 1, 'Website design: 5 pages', 2, 85000),
  ('10000000-0000-0000-0000-000000000001', 2, 'Content updates (hours)', 1.5, 35000);
do $$ begin
  assert (select total_cents from invoices where id = '10000000-0000-0000-0000-000000000001') = 222500, 'draft total should be 2x850 + 1.5x350 = R2,225.00';
  raise notice 'ok, draft total recalculated: R2,225.00';
end $$;

-- Issuing an empty draft fails and does not use up a number
select pg_temp.expect_error($q$ select issue_invoice('10000000-0000-0000-0000-000000000002') $q$, 'at least one line');

-- Tampering: drafts cannot be issued or created as issued directly
select pg_temp.expect_error($q$ update invoices set status = 'issued', seq = 99, number = 'BMS-0099', issue_date = current_date where id = '10000000-0000-0000-0000-000000000001' $q$, 'issue_invoice');
select pg_temp.expect_error($q$ insert into invoices (customer_id, status, seq, number, issue_date) values ('c0000000-0000-0000-0000-000000000001', 'issued', 50, 'BMS-0050', current_date) $q$, 'drafts');

-- Issue invoice 1
select number, issue_date = current_date as today, due_date - issue_date as terms_days, seller_snapshot->>'address' as seller_address
from issue_invoice('10000000-0000-0000-0000-000000000001');

-- Issued invoices are frozen
select pg_temp.expect_error($q$ update invoices set notes = 'changed' where id = '10000000-0000-0000-0000-000000000001' $q$, 'cannot be changed');
select pg_temp.expect_error($q$ update invoice_lines set unit_price_cents = 1 where invoice_id = '10000000-0000-0000-0000-000000000001' $q$, 'cannot be changed');
select pg_temp.expect_error($q$ insert into invoice_lines (invoice_id, description, unit_price_cents) values ('10000000-0000-0000-0000-000000000001', 'sneaky', 100) $q$, 'cannot be changed');
select pg_temp.expect_error($q$ update invoices set status = 'void' where id = '10000000-0000-0000-0000-000000000001' $q$, 'cannot be changed');
do $$ declare n int; begin
  delete from invoices where id = '10000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'issued invoice must not be deletable';
  raise notice 'ok, issued invoice not deletable (0 rows)';
end $$;

-- Payments
select pg_temp.expect_error($q$ insert into payments (invoice_id, amount_cents) values ('10000000-0000-0000-0000-000000000002', 1000) $q$, 'issued invoices');
insert into payments (id, invoice_id, amount_cents, method, reference) values ('e0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 100000, 'eft', 'BMS-0001');
select number, total_cents, paid_cents, balance_cents, is_overdue from invoice_balances where id = '10000000-0000-0000-0000-000000000001';

-- Voiding
select pg_temp.expect_error($q$ select void_invoice('10000000-0000-0000-0000-000000000001', 'Wrong customer') $q$, 'payments recorded');
select pg_temp.expect_error($q$ update invoices set status = 'void', void_reason = 'bypass', voided_at = now() where id = '10000000-0000-0000-0000-000000000001' $q$, 'cannot be changed');
delete from payments where id = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$ select void_invoice('10000000-0000-0000-0000-000000000001', '  ') $q$, 'reason is required');
select number, status, void_reason from void_invoice('10000000-0000-0000-0000-000000000001', 'Wrong customer');
select pg_temp.expect_error($q$ select void_invoice('10000000-0000-0000-0000-000000000001', 'again') $q$, 'Only issued');
select pg_temp.expect_error($q$ select void_invoice('10000000-0000-0000-0000-000000000002', 'draft') $q$, 'Only issued');

-- Next invoice gets the next number: no gap from the failed attempt
insert into invoice_lines (invoice_id, description, quantity, unit_price_cents) values ('10000000-0000-0000-0000-000000000002', 'Logo and brand kit', 1, 500000);
select number as second_number from issue_invoice('10000000-0000-0000-0000-000000000002');
insert into payments (invoice_id, amount_cents, method) values ('10000000-0000-0000-0000-000000000002', 500000, 'cash');

-- Drafts can be deleted, lines go with them
insert into invoices (id, customer_id) values ('10000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001');
insert into invoice_lines (invoice_id, description, unit_price_cents) values ('10000000-0000-0000-0000-000000000003', 'temp', 100);
delete from invoices where id = '10000000-0000-0000-0000-000000000003';
do $$ begin
  assert not exists (select 1 from invoices where id = '10000000-0000-0000-0000-000000000003'), 'draft should be deleted';
  assert not exists (select 1 from invoice_lines where invoice_id = '10000000-0000-0000-0000-000000000003'), 'lines should cascade';
  raise notice 'ok, draft and its lines deleted';
end $$;

-- Expenses: soft delete only
insert into expenses (id, amount_cents, category, supplier, receipt_path) values
  ('f0000000-0000-0000-0000-000000000001', 120050, 'software', 'Adobe', '2026/11/f0000000-0000-0000-0000-000000000001.jpg'),
  ('f0000000-0000-0000-0000-000000000002', 9900, 'hosting_domains', 'Domains.co.za', null);
select pg_temp.expect_error($q$ delete from expenses where id = 'f0000000-0000-0000-0000-000000000002' $q$, 'permission denied');
do $$ begin
  update expenses set deleted_at = now() where id = 'f0000000-0000-0000-0000-000000000002';
  assert (select deleted_at from expenses where id = 'f0000000-0000-0000-0000-000000000002') is not null, 'soft delete should work';
  raise notice 'ok, expense hard delete refused, soft delete works';
end $$;
select entry_date = current_date as today, kind, amount_cents, reference, party, category from ledger order by kind;

-- Receipts bucket
insert into storage.objects (bucket_id, name) values ('receipts', '2026/11/f0000000-0000-0000-0000-000000000001.jpg');
do $$ declare n int; begin
  delete from storage.objects where bucket_id = 'receipts';
  get diagnostics n = row_count;
  assert n = 0, 'receipts must not be deletable';
  raise notice 'ok, receipt upload works, delete refused (0 rows)';
end $$;

select pg_temp.expect_error($q$ select * from invoice_counter $q$, 'permission denied');
select pg_temp.expect_error($q$ update invoice_counter set last_seq = 0 $q$, 'permission denied');
select pg_temp.expect_error($q$ delete from audit_log $q$, 'permission denied');
do $$ begin
  assert (select count(*) from audit_log) > 10, 'audit log should have entries';
  raise notice 'ok, audit log has % entries', (select count(*) from audit_log);
end $$;

-- ===== Quotes and deposits (still team member A) =====
insert into quotes (id, customer_id, title) values ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Website for Mokoena Family');
insert into quotes (id, customer_id, title) values ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Logo');
do $$ begin
  assert (select number from quotes where id = 'a0000000-0000-0000-0000-000000000001') = 'BMS-Q-0001', 'first quote is BMS-Q-0001';
  assert (select deposit_percent from quotes where id = 'a0000000-0000-0000-0000-000000000001') = 50, 'deposit defaults to 50%';
  raise notice 'ok, quote numbered BMS-Q-0001 with a 50%% deposit';
end $$;
select pg_temp.expect_error($q$ insert into quotes (customer_id, status) values ('c0000000-0000-0000-0000-000000000001', 'sent') $q$, 'drafts');
select pg_temp.expect_error($q$ update quotes set number = 'BMS-Q-9999' where id = 'a0000000-0000-0000-0000-000000000001' $q$, 'cannot be changed');
select pg_temp.expect_error($q$ select nextval('quote_seq') $q$, 'permission denied');
select pg_temp.expect_error($q$ update quotes set status = 'sent' where id = 'a0000000-0000-0000-0000-000000000001' $q$, 'at least one line');
select pg_temp.expect_error($q$ update quotes set status = 'accepted' where id = 'a0000000-0000-0000-0000-000000000001' $q$, 'Send the quote');
insert into quote_lines (quote_id, position, description, quantity, unit_price_cents) values
  ('a0000000-0000-0000-0000-000000000001', 1, 'Website design and build', 1, 800000),
  ('a0000000-0000-0000-0000-000000000001', 2, 'Hosting and maintenance (months)', 12, 25000);
-- tampering with the draft total is undone when it is sent
update quotes set total_cents = 1 where id = 'a0000000-0000-0000-0000-000000000001';
update quotes set status = 'sent' where id = 'a0000000-0000-0000-0000-000000000001';
do $$ declare q quotes; begin
  select * into q from quotes where id = 'a0000000-0000-0000-0000-000000000001';
  assert q.total_cents = 1100000, 'quote total R11 000 recalculated on send';
  assert q.issue_date = current_date and q.valid_until = current_date + 30, 'valid for 30 days';
  assert q.customer_snapshot ->> 'name' = 'Mokoena Family' and q.seller_snapshot ->> 'trading_name' = 'Blue Monday Studios', 'snapshots taken';
  raise notice 'ok, sent quote: total, validity and snapshots set';
end $$;
select pg_temp.expect_error($q$ update quotes set title = 'changed' where id = 'a0000000-0000-0000-0000-000000000001' $q$, 'cannot be changed');
select pg_temp.expect_error($q$ insert into quote_lines (quote_id, description, unit_price_cents) values ('a0000000-0000-0000-0000-000000000001', 'sneaky', 1) $q$, 'cannot be changed');
select pg_temp.expect_error($q$ update quotes set status = 'draft' where id = 'a0000000-0000-0000-0000-000000000001' $q$, 'duplicate');
do $$ declare n int; begin
  delete from quotes where id = 'a0000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'sent quote must not be deletable';
  raise notice 'ok, sent quote frozen and not deletable';
end $$;
-- invoicing needs an accepted quote
select pg_temp.expect_error($q$ insert into invoices (customer_id, quote_id, kind) values ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'deposit') $q$, 'accepted quote');
update quotes set status = 'accepted' where id = 'a0000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select decided_at from quotes where id = 'a0000000-0000-0000-0000-000000000001') is not null, 'decided_at set';
  raise notice 'ok, quote accepted';
end $$;
-- deposit invoice (50%), issued and paid; then the balance
insert into invoices (id, customer_id, quote_id, kind) values ('20000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'deposit');
insert into invoice_lines (invoice_id, description, unit_price_cents) values ('20000000-0000-0000-0000-000000000001', 'Deposit (50%) for BMS-Q-0001', 550000);
select number as deposit_invoice from issue_invoice('20000000-0000-0000-0000-000000000001');
insert into payments (invoice_id, amount_cents, method) values ('20000000-0000-0000-0000-000000000001', 550000, 'eft');
insert into invoices (id, customer_id, quote_id, kind) values ('20000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'balance');
insert into invoice_lines (invoice_id, description, unit_price_cents) values ('20000000-0000-0000-0000-000000000002', 'Balance for BMS-Q-0001', 550000);
do $$ declare p quote_progress; begin
  select * into p from quote_progress where id = 'a0000000-0000-0000-0000-000000000001';
  assert p.invoiced_cents = 550000 and p.paid_cents = 550000 and p.left_to_invoice_cents = 550000 and p.draft_invoice_count = 1,
    format('quote progress after deposit: %s', row_to_json(p));
  raise notice 'ok, quote progress: deposit invoiced and paid, balance drafted';
end $$;
select number as balance_invoice from issue_invoice('20000000-0000-0000-0000-000000000002');
do $$ begin
  assert (select left_to_invoice_cents from quote_progress where id = 'a0000000-0000-0000-0000-000000000001') = 0, 'fully invoiced';
  assert (select quote_id from invoice_balances where id = '20000000-0000-0000-0000-000000000002') = 'a0000000-0000-0000-0000-000000000001', 'invoice_balances shows the quote';
  raise notice 'ok, quote fully invoiced';
end $$;
-- a declined quote can't be invoiced; draft quotes can be deleted
insert into quote_lines (quote_id, description, unit_price_cents) values ('a0000000-0000-0000-0000-000000000002', 'Logo', 300000);
update quotes set status = 'sent' where id = 'a0000000-0000-0000-0000-000000000002';
update quotes set status = 'declined' where id = 'a0000000-0000-0000-0000-000000000002';
select pg_temp.expect_error($q$ insert into invoices (customer_id, quote_id) values ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002') $q$, 'accepted quote');
insert into quotes (id, customer_id) values ('a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001');
insert into quote_lines (quote_id, description, unit_price_cents) values ('a0000000-0000-0000-0000-000000000003', 'temp', 100);
delete from quotes where id = 'a0000000-0000-0000-0000-000000000003';
do $$ begin
  assert not exists (select 1 from quotes where id = 'a0000000-0000-0000-0000-000000000003'), 'draft quote deleted';
  raise notice 'ok, declined quote not invoiceable; draft quote deletable';
end $$;
-- tampered draft invoice total is recalculated on issue
insert into invoices (id, customer_id) values ('20000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001');
insert into invoice_lines (invoice_id, description, unit_price_cents) values ('20000000-0000-0000-0000-000000000003', 'Business email setup', 75000);
update invoices set total_cents = 1 where id = '20000000-0000-0000-0000-000000000003';
do $$ begin
  assert (select total_cents from issue_invoice('20000000-0000-0000-0000-000000000003')) = 75000, 'issue recalculates the total';
  raise notice 'ok, tampered draft total corrected on issue';
end $$;

-- ===== As team member B: sees the same data =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  assert (select count(*) from invoices) = 5, 'team member B should see all five invoices';
  assert (select count(*) from quotes) = 2, 'and both quotes';
  raise notice 'ok, second team member sees the same records';
end $$;

-- ===== As a signed-in stranger =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', false);
do $$ begin
  assert (select count(*) from invoices) = 0 and (select count(*) from customers) = 0
     and (select count(*) from expenses) = 0 and (select count(*) from storage.objects) = 0
     and (select count(*) from audit_log) = 0 and (select count(*) from business_settings) = 0
     and (select count(*) from quotes) = 0 and (select count(*) from quote_progress) = 0,
     'stranger must see nothing';
  raise notice 'ok, stranger sees no rows anywhere';
end $$;
select pg_temp.expect_error($q$ insert into customers (name) values ('x') $q$, 'row-level security');
select pg_temp.expect_error($q$ insert into quotes (customer_id) values ('c0000000-0000-0000-0000-000000000001') $q$, 'row-level security');
select pg_temp.expect_error($q$ select issue_invoice('10000000-0000-0000-0000-000000000002') $q$, 'Not allowed');
select pg_temp.expect_error($q$ insert into storage.objects (bucket_id, name) values ('receipts', 'x.jpg') $q$, 'row-level security');

-- ===== Not signed in (anon) =====
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_error($q$ select count(*) from invoices $q$, 'permission denied');
select pg_temp.expect_error($q$ select count(*) from customers $q$, 'permission denied');
select pg_temp.expect_error($q$ insert into customers (name) values ('x') $q$, 'permission denied');
select pg_temp.expect_error($q$ select count(*) from quotes $q$, 'permission denied');
select pg_temp.expect_error($q$ select issue_invoice('10000000-0000-0000-0000-000000000002') $q$, 'permission denied');
reset role;
\echo ALL TESTS PASSED
