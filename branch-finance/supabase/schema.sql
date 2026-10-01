-- ფილიალის დღიური ანგარიშის სქემა. გაუშვით Supabase → SQL Editor-ში.

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  opening_balance numeric(12,2),            -- საწყისი ნაშთი (ერთჯერადად)
  sort_order int not null default 0
);

insert into branches (name, sort_order) values
  ('აბაშიძე', 1), ('ყაზბეგი', 2), ('ფალიაშვილი', 3), ('რამიშვილი', 4),
  ('წყნეთი', 5), ('სითი მოლი', 6), ('ისთფოინთი', 7)
on conflict (name) do nothing;

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  report_date date not null,
  manager_name text not null,
  status text not null default 'draft' check (status in ('draft','submitted')),
  turnover numeric(12,2) not null default 0,       -- დღის ნავაჭრი
  tbc numeric(12,2) not null default 0,
  bog numeric(12,2) not null default 0,
  keepz numeric(12,2) not null default 0,
  z_photo_path text,
  unreceipted_expense numeric(12,2) not null default 0,
  glovo numeric(12,2) not null default 0,
  wolt numeric(12,2) not null default 0,
  consignments numeric(12,2) not null default 0,
  actual_cash numeric(12,2),                       -- რეალურად მაქვს
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, report_date)
);

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  company text not null default '',
  tax_id text not null default '',
  amount numeric(12,2) not null,
  receipt_date date,
  photo_path text,
  read_by_ai boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists salaries (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  amount numeric(12,2) not null,
  salary_month text not null,                      -- 'YYYY-MM'
  created_at timestamptz not null default now()
);

create table if not exists cash_in (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  amount numeric(12,2) not null,
  comment text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists cash_out (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  amount numeric(12,2) not null,
  recipient text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists report_log (
  id bigserial primary key,
  report_id uuid not null references reports(id) on delete cascade,
  action text not null,                            -- submitted / reopened
  actor text not null,
  created_at timestamptz not null default now()
);

-- ფოტოების საცავი
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- ⚠ დროებითი: ავტორიზაცია ჯერ არ არის, ამიტომ anon როლს სრული წვდომა აქვს.
-- პაროლების დამატებისას ეს პოლისები უნდა გამკაცრდეს.
alter table branches enable row level security;
alter table reports enable row level security;
alter table receipts enable row level security;
alter table salaries enable row level security;
alter table cash_in enable row level security;
alter table cash_out enable row level security;
alter table report_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['branches','reports','receipts','salaries','cash_in','cash_out','report_log'] loop
    execute format('drop policy if exists "open_all" on %I', t);
    execute format('create policy "open_all" on %I for all to anon using (true) with check (true)', t);
  end loop;
end $$;

drop policy if exists "open_storage" on storage.objects;
create policy "open_storage" on storage.objects for all to anon
  using (bucket_id = 'receipts') with check (bucket_id = 'receipts');
