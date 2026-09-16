-- Disaster-recovery baseline shared by leaflet-review-app and setrik.cz.
-- The target project contained no business rows when this migration was written.
-- Keep the production hybrid ID contract: imports UUID, offers BIGINT.

begin;

create extension if not exists pgcrypto;

-- The original leaflet bootstrap used UUID offer IDs, while setrik.cz uses BIGINT.
-- These three tables are empty in the recovery project, so recreate only this core.
drop table if exists public.offers_quarantine cascade;
drop table if exists public.offers_raw cascade;
drop table if exists public.imports cascade;

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid null references public.import_batches(id) on delete set null,
  source_type text not null default 'manual',
  source_url text null,
  filename text null,
  note text null,
  status text not null default 'completed',
  import_batch_key text null,
  import_contract_version text null,
  import_contract_snapshot jsonb not null default '{}'::jsonb,
  bytes bigint null,
  offers_imported_count integer not null default 0,
  offers_raw_count integer not null default 0,
  offers_quarantine_count integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  took_ms integer null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null
);
create unique index imports_batch_id_uidx on public.imports(batch_id) where batch_id is not null;
create unique index imports_import_batch_key_uidx on public.imports(import_batch_key) where import_batch_key is not null;
create index imports_created_at_idx on public.imports(created_at desc);

create table public.offers_raw (
  id bigint generated always as identity primary key,
  import_id uuid null references public.imports(id) on delete set null,
  batch_id uuid null references public.import_batches(id) on delete set null,
  staging_offer_id uuid null references public.offers_staging(id) on delete set null,
  leaflet_id uuid null,
  page_no integer null,
  store_id text not null,
  store_branch_id bigint null,
  source_type text not null default 'leaflet',
  source_url text null,
  valid_from date null,
  valid_to date null,
  extracted_name text not null,
  normalized_name text null,
  normalized_name_canonical text null,
  price_total numeric(12,2) not null check (price_total >= 0),
  price_corrected_total numeric(12,2) null,
  price_standard numeric(12,2) null,
  price_after_sale numeric(12,2) null,
  price_with_loyalty_card numeric(12,2) null,
  typical_price_per_unit numeric(14,4) null,
  total_unit_2 numeric(14,4) null,
  currency text not null default 'CZK',
  pack_qty numeric null,
  pack_unit text null,
  pack_unit_qty numeric null,
  unit_base text null,
  unit_base_qty numeric null,
  unit_price_value numeric(14,4) null,
  unit_price_unit text null,
  is_multipack boolean not null default false,
  multipack_count numeric null,
  multipack_item_qty numeric null,
  multipack_item_unit text null,
  multipack_total_base_qty numeric null,
  has_loyalty_card_price boolean null,
  notes text null,
  raw_text_block text null,
  brand text null,
  brand_canonical text null,
  brand_type text null,
  category text null,
  category_canonical text null,
  subcategory text null,
  subcategory_canonical text null,
  promo_type text null,
  duplicate_candidate_key text null,
  comparable_group_key text null,
  product_family_key text null,
  pipeline_version text null,
  pipeline_note text null,
  review_status text not null default 'approved',
  review_reason text null,
  price_public_blocked boolean not null default false,
  price_anomaly_flag boolean not null default false,
  price_anomaly_severity text null,
  image_url text null,
  candidate_image_url text null,
  approved_image_key text null,
  suggested_image_key text null,
  image_key text null,
  candidate_image_key text null,
  primary_image_asset_id uuid null,
  display_image_source_type text null,
  image_review_status text null,
  image_admin_approved boolean not null default false,
  image_shadow_disabled boolean not null default false,
  image_shadow_review_status text null,
  inserted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint offers_raw_valid_range check (valid_from is null or valid_to is null or valid_from <= valid_to)
);
create index offers_raw_import_idx on public.offers_raw(import_id);
create index offers_raw_batch_idx on public.offers_raw(batch_id);
create index offers_raw_store_valid_idx on public.offers_raw(store_id, valid_to desc);
create index offers_raw_name_idx on public.offers_raw(normalized_name);
create index offers_raw_family_idx on public.offers_raw(product_family_key) where product_family_key is not null;
create index offers_raw_comparable_idx on public.offers_raw(comparable_group_key) where comparable_group_key is not null;

create table public.offers_quarantine (
  id bigint generated always as identity primary key,
  import_id uuid null references public.imports(id) on delete cascade,
  batch_id uuid null references public.import_batches(id) on delete cascade,
  staging_offer_id uuid null references public.offers_staging(id) on delete set null,
  quarantine_reason text null,
  reason text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index offers_quarantine_import_idx on public.offers_quarantine(import_id);
create index offers_quarantine_batch_idx on public.offers_quarantine(batch_id);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public, auth
as $$ select exists(select 1 from public.admin_users a where a.user_id = auth.uid()) $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

create table if not exists public.leaflet_documents (
  id uuid primary key default gen_random_uuid(),
  retailer_id text not null,
  storage_bucket text not null default 'leaflet-intake',
  storage_path text not null,
  filename text null,
  source_url text null,
  source_leaflet_number text null,
  internal_leaflet_key text not null,
  valid_from date null,
  valid_to date null,
  page_count integer not null default 0,
  processed_pages integer not null default 0,
  candidate_count integer not null default 0,
  unreviewed_count integer not null default 0,
  approved_count integer not null default 0,
  rejected_count integer not null default 0,
  quarantine_count integer not null default 0,
  processing_status text not null default 'pending',
  processing_error text null,
  processing_completed_at timestamptz null,
  import_id uuid null references public.imports(id) on delete set null,
  notification_status text not null default 'pending',
  notification_sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(storage_bucket, storage_path),
  unique(internal_leaflet_key),
  constraint leaflet_documents_valid_range check (valid_from is null or valid_to is null or valid_from <= valid_to)
);
create index if not exists leaflet_documents_retailer_created_idx on public.leaflet_documents(retailer_id, created_at desc);

alter table public.offers_raw
  add constraint offers_raw_leaflet_id_fkey foreign key (leaflet_id)
  references public.leaflet_documents(id) on delete set null;

create table if not exists public.leaflet_page_processing (
  id uuid primary key default gen_random_uuid(),
  leaflet_id uuid not null references public.leaflet_documents(id) on delete cascade,
  page_no integer not null check (page_no > 0),
  status text not null default 'pending',
  attempt_count integer not null default 0,
  source_kind text null,
  source_url text null,
  source_text_hash text null,
  text_length integer null,
  processing_error text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(leaflet_id, page_no)
);

create table if not exists public.leaflet_item_candidates (
  id uuid primary key default gen_random_uuid(),
  leaflet_id uuid not null references public.leaflet_documents(id) on delete cascade,
  candidate_key text not null,
  page_no integer not null check (page_no > 0),
  source_bbox jsonb null,
  source_text text null,
  product_name text null,
  brand text null,
  variant text null,
  pack_qty numeric null,
  pack_unit text null,
  pack_unit_qty numeric null,
  pack_text text null,
  price_sale numeric(12,2) null,
  price_standard numeric(12,2) null,
  price_loyalty numeric(12,2) null,
  price_without_loyalty numeric(12,2) null,
  price_per_unit numeric(14,4) null,
  price_per_unit_unit text null,
  currency text not null default 'CZK',
  leaflet_valid_from date null,
  leaflet_valid_to date null,
  item_valid_from date null,
  item_valid_to date null,
  loyalty_required boolean null,
  promo_label text null,
  promo_condition text null,
  minimum_quantity numeric null,
  field_evidence jsonb not null default '{}'::jsonb,
  extraction_payload jsonb not null default '{}'::jsonb,
  extractor_version text null,
  confidence numeric null,
  status text not null default 'unreviewed',
  review_reason text null,
  reviewed_at timestamptz null,
  revision integer not null default 1,
  reread_count integer not null default 0,
  last_reread_at timestamptz null,
  approved_offer_id bigint null references public.offers_raw(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(leaflet_id, candidate_key)
);
create index if not exists leaflet_candidates_page_idx on public.leaflet_item_candidates(leaflet_id, page_no);
create index if not exists leaflet_candidates_status_idx on public.leaflet_item_candidates(status, created_at);

create table if not exists public.leaflet_item_review_audit (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.leaflet_item_candidates(id) on delete cascade,
  action text not null,
  previous_payload jsonb null,
  next_payload jsonb null,
  note text null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists leaflet_review_audit_candidate_idx on public.leaflet_item_review_audit(candidate_id, created_at desc);

create table if not exists public.leaflet_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  leaflet_id uuid not null references public.leaflet_documents(id) on delete cascade,
  channel text not null default 'email',
  recipient text null,
  subject text not null,
  body_text text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(leaflet_id, channel)
);

create table if not exists public.brand_aliases (
  id bigint generated always as identity primary key,
  alias text not null unique,
  canonical_brand text not null,
  created_at timestamptz not null default now()
);

create or replace view public.offers_visible
with (security_invoker = true)
as
select
  o.*,
  (current_date between coalesce(o.valid_from, current_date) and coalesce(o.valid_to, current_date)) as is_active_today,
  (o.valid_from is not null and o.valid_from > current_date) as is_future
from public.offers_raw o
where coalesce(o.review_status, 'approved') not in ('rejected', 'quarantine')
  and not coalesce(o.price_public_blocked, false);

create or replace view public.offers_duplicate_report
with (security_invoker = true)
as
select duplicate_candidate_key, count(*) as duplicate_count, array_agg(id order by id) as offer_ids
from public.offers_raw
where duplicate_candidate_key is not null
group by duplicate_candidate_key
having count(*) > 1;

create or replace view public.offers_duplicate_between_imports
with (security_invoker = true)
as
select duplicate_candidate_key, count(distinct import_id) as import_count, count(*) as offer_count
from public.offers_raw
where duplicate_candidate_key is not null
group by duplicate_candidate_key
having count(distinct import_id) > 1;

create table if not exists public.user_watchlist (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_key text not null,
  created_at timestamptz not null default now(),
  unique(user_id, product_key)
);

create table if not exists public.user_shopping_list (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  list_key text not null,
  entry_type text not null check (entry_type in ('product','category','product_store')),
  label text not null,
  offer_id text null,
  category text null,
  store_id text null,
  name_hint text null,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, list_key)
);

create table if not exists public.content_entries (
  content_key text primary key,
  default_value text not null default '',
  draft_value text null,
  admin_override_value text null,
  approved_value text null,
  seo_title text null,
  seo_description text null,
  seo_keywords text[] null,
  search_keywords text[] null,
  updated_at timestamptz null,
  updated_by uuid null references auth.users(id) on delete set null,
  published_at timestamptz null,
  published_by uuid null references auth.users(id) on delete set null
);
create table if not exists public.content_entry_audit (
  id uuid primary key default gen_random_uuid(),
  content_key text not null,
  action text not null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_email text null,
  previous_value text null,
  next_value text null,
  payload jsonb null,
  created_at timestamptz not null default now()
);
create table if not exists public.media_library (
  id uuid primary key default gen_random_uuid(),
  asset_key text not null unique,
  file_url text not null,
  file_type text null,
  width integer null,
  height integer null,
  checksum text null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create or replace view public.content_entries_public
with (security_invoker = true)
as select content_key, default_value, admin_override_value, approved_value,
          seo_title, seo_description, seo_keywords, search_keywords, updated_at, published_at
from public.content_entries
where published_at is not null or approved_value is not null or admin_override_value is not null;

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  idempotency_key text null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  raw_query text not null,
  quantity integer not null default 1 check (quantity > 0),
  must_buy boolean not null default false,
  max_wait_days integer null check (max_wait_days is null or max_wait_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.retailers (
  id bigint generated by default as identity primary key,
  slug text not null unique,
  name text not null,
  website_url text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.store_branches (
  id bigint generated by default as identity primary key,
  retailer_id bigint not null references public.retailers(id) on delete cascade,
  external_id text null,
  name text not null,
  address_line text not null,
  city text not null,
  postcode text null,
  region text null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(retailer_id, external_id)
);
alter table public.offers_raw
  add constraint offers_raw_store_branch_id_fkey foreign key (store_branch_id)
  references public.store_branches(id) on delete set null;

insert into public.retailers(slug,name) values
  ('albert','Albert'),('billa','BILLA'),('globus','Globus'),('kaufland','Kaufland'),
  ('lidl','Lidl'),('penny','PENNY'),('tesco','Tesco'),('dm','dm'),('rossmann','ROSSMANN'),('teta','Teta')
on conflict(slug) do update set name=excluded.name, active=true;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('leaflet-intake','leaflet-intake',false,52428800,array['application/pdf','application/json']),
  ('product-types','product-types',true,6291456,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

-- RLS: public surface is intentionally narrow; operational tables are service-role only.
alter table public.imports enable row level security;
alter table public.offers_raw enable row level security;
alter table public.offers_quarantine enable row level security;
alter table public.admin_users enable row level security;
alter table public.leaflet_documents enable row level security;
alter table public.leaflet_page_processing enable row level security;
alter table public.leaflet_item_candidates enable row level security;
alter table public.leaflet_item_review_audit enable row level security;
alter table public.leaflet_notification_outbox enable row level security;
alter table public.brand_aliases enable row level security;
alter table public.user_watchlist enable row level security;
alter table public.user_shopping_list enable row level security;
alter table public.content_entries enable row level security;
alter table public.content_entry_audit enable row level security;
alter table public.media_library enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.retailers enable row level security;
alter table public.store_branches enable row level security;

create policy offers_raw_public_read on public.offers_raw for select to anon, authenticated
using (coalesce(review_status,'approved') not in ('rejected','quarantine') and not coalesce(price_public_blocked,false));
create policy watchlist_own_all on public.user_watchlist for all to authenticated
using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy shopping_list_own_all on public.user_shopping_list for all to authenticated
using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy content_entries_admin_all on public.content_entries for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy content_entries_public_select on public.content_entries for select to anon, authenticated
using (published_at is not null or approved_value is not null or admin_override_value is not null);
create policy content_audit_admin_all on public.content_entry_audit for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy media_admin_all on public.media_library for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy media_public_read on public.media_library for select to anon, authenticated using (true);
create policy retailers_public_read on public.retailers for select to anon, authenticated using (active);
create policy branches_public_read on public.store_branches for select to anon, authenticated using (active);

revoke all on all tables in schema public from anon, authenticated;
grant select on public.offers_raw, public.offers_visible, public.retailers, public.store_branches,
  public.content_entries, public.content_entries_public, public.media_library to anon, authenticated;
grant select, insert, update, delete on public.user_watchlist, public.user_shopping_list to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;
