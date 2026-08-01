-- Make the moderator role mean what the invite UI says it means.
--
-- can_manage_server admits both admins and moderators, and the `servers`
-- UPDATE policy used it — so a moderator could change settings, software or
-- version despite being told they could not. Enforcing it only in the route
-- handler would still leave PostgREST open to a moderator's own token, so the
-- boundary belongs here.
--
-- Operational tables (add-ons, players, backups) keep can_manage_server:
-- moderators are supposed to run the server day to day.

create or replace function private.can_administer_server(target uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from servers s where s.id = target and s.owner_id = auth.uid())
      or exists (
        select 1 from server_access a
        where a.server_id = target and a.user_id = auth.uid() and a.role = 'admin'
      );
$$;

alter policy "managers update servers" on servers
  using (private.can_administer_server(id));
