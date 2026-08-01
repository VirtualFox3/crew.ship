-- Hardening pass over 0001.
--
-- The helper functions have to be SECURITY DEFINER, or the RLS policy on
-- `servers` recurses through `server_access`. But anything in `public` is also
-- published by PostgREST as an RPC, so `can_access_server` was callable by any
-- anonymous visitor. Moving them to a private schema keeps them usable from
-- policies while removing them from the API surface entirely.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon, service_role;

create or replace function private.can_access_server(target uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from servers s where s.id = target and s.owner_id = auth.uid())
      or exists (select 1 from server_access a where a.server_id = target and a.user_id = auth.uid());
$$;

create or replace function private.can_manage_server(target uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from servers s where s.id = target and s.owner_id = auth.uid())
      or exists (select 1 from server_access a where a.server_id = target and a.user_id = auth.uid()
                 and a.role in ('admin','moderator'));
$$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text; candidate text; suffix int := 0;
begin
  base := regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'username', new.raw_user_meta_data ->> 'user_name',
             split_part(new.email, '@', 1), 'player'), '[^a-zA-Z0-9_]', '', 'g');
  if length(base) < 3 then base := base || 'player'; end if;
  base := left(base, 20);
  candidate := base;
  while exists (select 1 from profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := left(base, 20) || suffix::text;
  end loop;
  insert into profiles (id, username, display_name, avatar_url)
  values (new.id, candidate,
          coalesce(new.raw_user_meta_data ->> 'full_name', candidate),
          new.raw_user_meta_data ->> 'avatar_url');
  return new;
end;
$$;

-- Pinning search_path stops a caller-controlled path from resolving `now()`
-- to something else.
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;

-- Repoint every policy. ALTER POLICY keeps the command and role bindings.
alter policy "read own or shared servers" on servers using (private.can_access_server(id));
alter policy "managers update servers"    on servers using (private.can_manage_server(id));
alter policy "read access rows"           on server_access using (private.can_access_server(server_id) or user_id = auth.uid());

alter policy "read addons"   on server_addons using (private.can_access_server(server_id));
alter policy "manage addons" on server_addons using (private.can_manage_server(server_id)) with check (private.can_manage_server(server_id));

alter policy "read players"   on server_players using (private.can_access_server(server_id));
alter policy "manage players" on server_players using (private.can_manage_server(server_id)) with check (private.can_manage_server(server_id));

alter policy "read backups"   on backups using (private.can_access_server(server_id));
alter policy "manage backups" on backups using (private.can_manage_server(server_id)) with check (private.can_manage_server(server_id));

alter policy "read events" on server_events using (private.can_access_server(server_id));

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function private.handle_new_user();

drop trigger if exists servers_touch on servers;
create trigger servers_touch before update on servers
  for each row execute function private.touch_updated_at();

drop function if exists public.can_access_server(uuid);
drop function if exists public.can_manage_server(uuid);
drop function if exists public.handle_new_user();
drop function if exists public.touch_updated_at();

-- Keep extensions out of the schema PostgREST exposes.
create schema if not exists extensions;
grant usage on schema extensions to authenticated, anon, service_role;
alter extension citext set schema extensions;

-- `nodes.agent_url` is a control-plane endpoint. Every read in the panel uses
-- the service-role client, so nothing needs it to be publicly readable.
drop policy if exists "nodes readable" on nodes;
