-- Keep the live project aligned with the Crew.Ship rebrand.
-- Existing servers keep their saved MOTD; only future servers use this default.

alter table public.servers
  alter column motd set default 'A Crew.Ship server';

comment on table public.nodes is 'Crew.Ship host nodes.';
comment on column public.nodes.agent_url is 'Crew.Ship host control endpoint.';
comment on column public.servers.subdomain is 'Crew.Ship server address label.';
