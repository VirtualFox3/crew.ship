-- PostgREST's anonymous role retains a default function grant unless it is
-- explicitly revoked by role. Only signed-in Crew.Ship accounts may redeem.
revoke all on function public.accept_server_admin_invite(uuid) from anon;
