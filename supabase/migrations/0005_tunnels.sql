-- Tunnel support (playit.gg and friends).
--
-- A node does not need a public IP or a domain to host servers. A tunnel agent
-- on the node holds an outbound connection to a relay, and players connect to
-- the relay's hostname instead. That makes home machines and NAT'd boxes
-- viable, and removes the domain purchase from the setup path entirely.
--
-- tunnel_ports maps the node-local port to the port the relay publishes, since
-- a relay rarely hands back the same number: {"25601": 41234}.

alter table nodes add column tunnel_host  text;
alter table nodes add column tunnel_ports jsonb not null default '{}'::jsonb;

comment on column nodes.tunnel_host is
  'Public hostname of the tunnel relay, e.g. abc.craft.playit.gg. Null when players reach the node directly.';
comment on column nodes.tunnel_ports is
  'Map of node-local port to relay-published port, as {"25601": 41234}.';
