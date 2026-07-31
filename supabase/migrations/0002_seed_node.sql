-- Optional: register your first node.
--
-- Run this once you have a machine ready to host servers, then copy the
-- returned id into the agent's NODE_ID. `status` stays 'offline' until the
-- agent's first heartbeat arrives.

insert into nodes (
  name, region, agent_url, public_host,
  max_servers, max_memory_mb,
  port_range_start, port_range_end,
  status
)
values (
  'node-1',
  'eu-central',
  'https://node1.example.com',   -- where the panel reaches the agent
  'node1.example.com',           -- what players connect to
  40,
  32768,
  25600,
  25999,
  'offline'
)
returning id;
