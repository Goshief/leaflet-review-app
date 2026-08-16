create table if not exists public.auth_login_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default statement_timestamp(),
  attempts integer not null default 0 check (attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default statement_timestamp()
);

alter table public.auth_login_rate_limits enable row level security;

revoke all on table public.auth_login_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_login_rate_limits to service_role;

create or replace function public.consume_login_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_row public.auth_login_rate_limits%rowtype;
begin
  if p_key_hash is null or length(p_key_hash) != 64 then
    raise exception 'invalid rate-limit key';
  end if;

  if p_limit < 1 or p_window_seconds < 1 or p_block_seconds < 1 then
    raise exception 'invalid rate-limit configuration';
  end if;

  insert into public.auth_login_rate_limits (key_hash)
  values (p_key_hash)
  on conflict (key_hash) do nothing;

  select *
  into v_row
  from public.auth_login_rate_limits
  where key_hash = p_key_hash
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    allowed := false;
    retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer
    );
    return next;
    return;
  end if;

  if v_row.window_started_at <= v_now - make_interval(secs => p_window_seconds) then
    update public.auth_login_rate_limits
    set window_started_at = v_now,
        attempts = 1,
        blocked_until = null,
        updated_at = v_now
    where key_hash = p_key_hash;

    allowed := true;
    retry_after_seconds := 0;
    return next;
    return;
  end if;

  if v_row.attempts >= p_limit then
    update public.auth_login_rate_limits
    set blocked_until = v_now + make_interval(secs => p_block_seconds),
        updated_at = v_now
    where key_hash = p_key_hash;

    allowed := false;
    retry_after_seconds := p_block_seconds;
    return next;
    return;
  end if;

  update public.auth_login_rate_limits
  set attempts = attempts + 1,
      blocked_until = null,
      updated_at = v_now
  where key_hash = p_key_hash;

  allowed := true;
  retry_after_seconds := 0;
  return next;
end;
$$;

revoke execute on function public.consume_login_rate_limit(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_login_rate_limit(text, integer, integer, integer)
  to service_role;

create or replace function public.clear_login_rate_limit(p_key_hash text)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.auth_login_rate_limits where key_hash = p_key_hash;
$$;

revoke execute on function public.clear_login_rate_limit(text)
  from public, anon, authenticated;
grant execute on function public.clear_login_rate_limit(text)
  to service_role;
