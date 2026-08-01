-- Track each node's CPU architecture.
--
-- Mojang ships the Bedrock Dedicated Server for x86 only. Free tiers — Oracle
-- Cloud's Always Free in particular — hand out ARM machines, so without this
-- the panel would happily let someone create a Bedrock server on a node that
-- can never run it. The agent reports its own architecture on every heartbeat.

create type node_arch as enum ('x64', 'arm64');

alter table nodes add column arch node_arch not null default 'x64';

comment on column nodes.arch is
  'CPU architecture reported by the agent. Drives which server software the panel offers.';
