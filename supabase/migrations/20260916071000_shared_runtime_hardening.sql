begin;

alter function public.set_updated_at() set search_path = public;
revoke execute on function public.is_admin() from anon;

drop policy if exists watchlist_own_all on public.user_watchlist;
create policy watchlist_own_all on public.user_watchlist for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists shopping_list_own_all on public.user_shopping_list;
create policy shopping_list_own_all on public.user_shopping_list for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create index if not exists cart_items_cart_id_idx on public.cart_items(cart_id);
create index if not exists content_entries_updated_by_idx on public.content_entries(updated_by) where updated_by is not null;
create index if not exists content_entries_published_by_idx on public.content_entries(published_by) where published_by is not null;
create index if not exists content_entry_audit_actor_idx on public.content_entry_audit(actor_user_id) where actor_user_id is not null;
create index if not exists imports_created_by_idx on public.imports(created_by) where created_by is not null;
create index if not exists leaflet_documents_import_idx on public.leaflet_documents(import_id) where import_id is not null;
create index if not exists leaflet_candidates_offer_idx on public.leaflet_item_candidates(approved_offer_id) where approved_offer_id is not null;
create index if not exists leaflet_review_audit_actor_idx on public.leaflet_item_review_audit(actor_user_id) where actor_user_id is not null;
create index if not exists media_library_created_by_idx on public.media_library(created_by) where created_by is not null;
create index if not exists offers_quarantine_staging_idx on public.offers_quarantine(staging_offer_id) where staging_offer_id is not null;
create index if not exists offers_raw_leaflet_idx on public.offers_raw(leaflet_id) where leaflet_id is not null;
create index if not exists offers_raw_staging_idx on public.offers_raw(staging_offer_id) where staging_offer_id is not null;
create index if not exists offers_raw_store_branch_idx on public.offers_raw(store_branch_id) where store_branch_id is not null;

commit;
