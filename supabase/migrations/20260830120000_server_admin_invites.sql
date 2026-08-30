-- One-use, owner-created invitation links for Crew.Ship server admins.
create table public.server_invites (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  role access_role not null default 'admin' check (role = 'admin'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index server_invites_server_idx on public.server_invites(server_id);

alter table public.server_invites enable row level security;

create policy "owners manage server invites"
  on public.server_invites for all to authenticated
  using (exists (
    select 1 from public.servers s
    where s.id = server_id and s.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.servers s
    where s.id = server_id and s.owner_id = (select auth.uid())
  ));

create or replace function public.accept_server_admin_invite(invite_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invite server_invites%rowtype;
  recipient uuid := auth.uid();
begin
  if recipient is null then
    raise exception 'Sign in before accepting an invitation.';
  end if;

  update server_invites
  set redeemed_at = now(), redeemed_by = recipient
  where token = invite_token
    and redeemed_at is null
    and expires_at > now()
  returning * into invite;

  if invite.id is null then
    raise exception 'This invite link is invalid, expired, or was already used.';
  end if;

  if exists (select 1 from servers where id = invite.server_id and owner_id = recipient) then
    return invite.server_id;
  end if;

  insert into server_access (server_id, user_id, role, permissions)
  values (
    invite.server_id,
    recipient,
    'admin',
    array['console','command','power','players','addons','files','backups','worlds','settings']
  )
  on conflict (server_id, user_id) do update
    set role = excluded.role, permissions = excluded.permissions;

  return invite.server_id;
end;
$$;

revoke all on function public.accept_server_admin_invite(uuid) from public;
grant execute on function public.accept_server_admin_invite(uuid) to authenticated;
