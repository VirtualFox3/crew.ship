-- Per-capability access instead of three fixed tiers.
--
-- The role stays as a label and a preset, but what actually decides access is
-- an explicit list of capabilities. Existing invites are unaffected: a null
-- permissions column falls back to that role's preset, which is exactly the
-- behaviour those rows had before.

alter table server_access add column permissions text[];

comment on column server_access.permissions is
  'Explicit capability grants. Null means fall back to the role preset.';

-- The preset a role implies, kept in SQL so policies do not depend on the app.
create or replace function private.default_permissions(role access_role)
returns text[] language sql immutable as $$
  select case role
    when 'owner' then array['console','command','power','players','addons','files','backups','worlds','settings']
    when 'admin' then array['console','command','power','players','addons','files','backups','worlds','settings']
    when 'moderator' then array['console','command','power','players','addons','files','backups']
    when 'viewer' then array['console']
    else array[]::text[]
  end;
$$;

create or replace function private.has_permission(target uuid, cap text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from servers s where s.id = target and s.owner_id = auth.uid())
      or exists (
        select 1 from server_access a
        where a.server_id = target
          and a.user_id = auth.uid()
          and cap = any(coalesce(a.permissions, private.default_permissions(a.role)))
      );
$$;

-- Each table now answers to the capability it actually represents, rather than
-- to a coarse "can manage" that lumped unrelated powers together.
alter policy "manage addons"  on server_addons
  using (private.has_permission(server_id, 'addons'))
  with check (private.has_permission(server_id, 'addons'));

alter policy "manage players" on server_players
  using (private.has_permission(server_id, 'players'))
  with check (private.has_permission(server_id, 'players'));

alter policy "manage backups" on backups
  using (private.has_permission(server_id, 'backups'))
  with check (private.has_permission(server_id, 'backups'));

alter policy "managers update servers" on servers
  using (private.has_permission(id, 'settings'));
