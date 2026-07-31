-- Pack.Host — core schema
-- Free, unlimited Minecraft server hosting (Java + Bedrock).

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type server_status as enum (
  'offline',      -- stopped, no container
  'queued',       -- waiting for capacity on a node
  'preparing',    -- downloading jar / building image
  'starting',     -- container up, world loading
  'online',       -- accepting players
  'stopping',
  'crashed'
);

create type server_edition as enum ('java', 'bedrock', 'hybrid');

create type server_software as enum (
  -- Java: vanilla + modded + plugin platforms
  'vanilla', 'paper', 'purpur', 'spigot', 'folia', 'pufferfish',
  'fabric', 'forge', 'neoforge', 'quilt',
  -- Proxies
  'velocity', 'bungeecord', 'waterfall',
  -- Bedrock
  'bedrock', 'pocketmine', 'nukkit'
);

create type addon_kind as enum ('plugin', 'mod', 'datapack', 'modpack', 'resourcepack');
create type addon_source as enum ('modrinth', 'hangar', 'spigot', 'curseforge', 'url', 'upload');
create type player_list as enum ('whitelist', 'op', 'ban');
create type access_role as enum ('owner', 'admin', 'moderator', 'viewer');
create type node_status as enum ('online', 'draining', 'offline');

-- ---------------------------------------------------------------------------
-- Profiles (one row per auth user)
-- ---------------------------------------------------------------------------

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      citext unique not null,
  display_name  text,
  avatar_url    text,
  minecraft_uuid text,
  timezone      text not null default 'UTC',
  -- Everything is free. These are fair-use ceilings, not paywalls.
  server_limit  int  not null default 4,
  created_at    timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-zA-Z0-9_]{3,24}$')
);

alter table profiles enable row level security;

create policy "profiles are readable by everyone"
  on profiles for select using (true);
create policy "users update own profile"
  on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "users insert own profile"
  on profiles for insert with check (auth.uid() = id);

-- Auto-create a profile on signup. Falls back to a generated handle when the
-- signup metadata has no username (OAuth flows).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base text;
  candidate text;
  suffix int := 0;
begin
  base := regexp_replace(
    coalesce(
      new.raw_user_meta_data ->> 'username',
      new.raw_user_meta_data ->> 'user_name',
      split_part(new.email, '@', 1),
      'player'
    ), '[^a-zA-Z0-9_]', '', 'g');

  if length(base) < 3 then
    base := base || 'player';
  end if;
  base := left(base, 20);
  candidate := base;

  while exists (select 1 from profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := left(base, 20) || suffix::text;
  end loop;

  insert into profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data ->> 'full_name', candidate),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Nodes — machines running the Pack.Host agent
-- ---------------------------------------------------------------------------

create table nodes (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  region         text not null default 'global',
  agent_url      text not null,          -- https://node1.pack.host
  public_host    text not null,          -- hostname players connect to
  status         node_status not null default 'offline',
  max_servers    int not null default 40,
  max_memory_mb  int not null default 65536,
  used_memory_mb int not null default 0,
  running_count  int not null default 0,
  port_range_start int not null default 25600,
  port_range_end   int not null default 25999,
  last_heartbeat timestamptz,
  created_at     timestamptz not null default now()
);

alter table nodes enable row level security;
-- Node rows carry no secrets (the shared key lives in env), so the panel shows
-- capacity publicly; only the service role writes.
create policy "nodes readable" on nodes for select using (true);

-- ---------------------------------------------------------------------------
-- Servers
-- ---------------------------------------------------------------------------

create table servers (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references profiles(id) on delete cascade,
  node_id         uuid references nodes(id) on delete set null,

  name            text not null,
  subdomain       citext unique not null,      -- <subdomain>.pack.host
  custom_domain   text unique,

  edition         server_edition not null default 'java',
  software        server_software not null default 'paper',
  version         text not null,               -- '1.21.4', 'latest', ...
  build           text,                        -- paper build / loader version

  status          server_status not null default 'offline',
  status_detail   text,

  -- Resources. Free tier, but bounded so one server can't eat a node.
  memory_mb       int not null default 4096,
  max_players     int not null default 100,
  cpu_cores       numeric(3,1) not null default 2.0,
  storage_mb      int not null default 20480,

  -- Networking
  java_port       int,
  bedrock_port    int,

  -- Gameplay defaults mirrored into server.properties
  motd            text not null default 'A Pack.Host server',
  gamemode        text not null default 'survival',
  difficulty      text not null default 'normal',
  seed            text,
  level_type      text not null default 'minecraft:normal',
  pvp             boolean not null default true,
  online_mode     boolean not null default true,
  whitelist_on    boolean not null default false,
  command_blocks  boolean not null default true,
  flight          boolean not null default false,
  view_distance   int not null default 10,
  simulation_distance int not null default 10,
  hardcore        boolean not null default false,
  spawn_protection int not null default 0,
  -- Geyser/Floodgate bridge so Bedrock clients can join a Java server
  crossplay       boolean not null default false,

  icon_url        text,
  auto_stop_minutes int not null default 15,   -- 0 disables idle shutdown
  auto_start      boolean not null default false,
  java_flags      text,

  players_online  int not null default 0,
  queue_position  int,
  last_online_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint memory_range check (memory_mb between 1024 and 16384),
  constraint players_range check (max_players between 1 and 1000),
  constraint subdomain_format check (subdomain ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$')
);

create index servers_owner_idx on servers(owner_id);
create index servers_status_idx on servers(status);
create index servers_node_idx on servers(node_id);

-- ---------------------------------------------------------------------------
-- Shared access — invite friends to co-manage a server
-- ---------------------------------------------------------------------------

create table server_access (
  server_id  uuid not null references servers(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       access_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create index server_access_user_idx on server_access(user_id);

-- Helper used by every policy below. SECURITY DEFINER keeps `servers` policies
-- from recursing back through `server_access`.
create or replace function public.can_access_server(target uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from servers s where s.id = target and s.owner_id = auth.uid())
      or exists (select 1 from server_access a where a.server_id = target and a.user_id = auth.uid());
$$;

create or replace function public.can_manage_server(target uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from servers s where s.id = target and s.owner_id = auth.uid())
      or exists (
        select 1 from server_access a
        where a.server_id = target and a.user_id = auth.uid()
          and a.role in ('admin', 'moderator')
      );
$$;

alter table servers enable row level security;

create policy "read own or shared servers"
  on servers for select using (public.can_access_server(id));
create policy "owner inserts servers"
  on servers for insert with check (auth.uid() = owner_id);
create policy "managers update servers"
  on servers for update using (public.can_manage_server(id));
create policy "owner deletes servers"
  on servers for delete using (auth.uid() = owner_id);

alter table server_access enable row level security;
create policy "read access rows"
  on server_access for select using (public.can_access_server(server_id) or user_id = auth.uid());
create policy "owner manages access"
  on server_access for all
  using (exists (select 1 from servers s where s.id = server_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from servers s where s.id = server_id and s.owner_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Add-ons — plugins, mods, datapacks, modpacks. No cap: unlimited by design.
-- ---------------------------------------------------------------------------

create table server_addons (
  id           uuid primary key default gen_random_uuid(),
  server_id    uuid not null references servers(id) on delete cascade,
  kind         addon_kind not null,
  source       addon_source not null,
  project_id   text,
  version_id   text,
  name         text not null,
  slug         text,
  author       text,
  icon_url     text,
  filename     text not null,
  download_url text,
  version_name text,
  enabled      boolean not null default true,
  installed_at timestamptz not null default now(),
  unique (server_id, filename)
);

create index server_addons_server_idx on server_addons(server_id);

alter table server_addons enable row level security;
create policy "read addons" on server_addons for select using (public.can_access_server(server_id));
create policy "manage addons" on server_addons for all
  using (public.can_manage_server(server_id))
  with check (public.can_manage_server(server_id));

-- ---------------------------------------------------------------------------
-- Player lists — whitelist / operators / bans
-- ---------------------------------------------------------------------------

create table server_players (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid not null references servers(id) on delete cascade,
  list       player_list not null,
  username   text not null,
  uuid       text,
  level      int,                -- op level 1-4
  reason     text,               -- ban reason
  created_at timestamptz not null default now(),
  unique (server_id, list, username)
);

create index server_players_server_idx on server_players(server_id);

alter table server_players enable row level security;
create policy "read players" on server_players for select using (public.can_access_server(server_id));
create policy "manage players" on server_players for all
  using (public.can_manage_server(server_id))
  with check (public.can_manage_server(server_id));

-- ---------------------------------------------------------------------------
-- Backups
-- ---------------------------------------------------------------------------

create table backups (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid not null references servers(id) on delete cascade,
  name       text not null,
  filename   text not null,
  size_bytes bigint not null default 0,
  automatic  boolean not null default false,
  created_at timestamptz not null default now()
);

create index backups_server_idx on backups(server_id);

alter table backups enable row level security;
create policy "read backups" on backups for select using (public.can_access_server(server_id));
create policy "manage backups" on backups for all
  using (public.can_manage_server(server_id))
  with check (public.can_manage_server(server_id));

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create table server_events (
  id         bigserial primary key,
  server_id  uuid not null references servers(id) on delete cascade,
  actor_id   uuid references profiles(id) on delete set null,
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);

create index server_events_server_idx on server_events(server_id, created_at desc);

alter table server_events enable row level security;
create policy "read events" on server_events for select using (public.can_access_server(server_id));

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger servers_touch
  before update on servers
  for each row execute function public.touch_updated_at();

-- Realtime: the dashboard subscribes to server rows for live status pills.
alter publication supabase_realtime add table servers;
