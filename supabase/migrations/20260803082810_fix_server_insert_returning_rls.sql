-- INSERT ... RETURNING also evaluates the SELECT policy. The original policy
-- checked ownership only through a STABLE helper that queries `servers`, so it
-- could not see the row created by the current command and rejected an
-- otherwise valid owner insert. Keep the helper for shared access, but check
-- direct ownership from the row first.
alter policy "read own or shared servers"
  on public.servers
  to authenticated
  using (
    owner_id = (select auth.uid())
    or private.can_access_server(id)
  );

-- The insert boundary is owner-only and should never apply to anonymous API
-- traffic. `select auth.uid()` is evaluated once per statement.
alter policy "owner inserts servers"
  on public.servers
  to authenticated
  with check (owner_id = (select auth.uid()));
