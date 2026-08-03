alter table public.nodes
  add column owner_id uuid not null references public.profiles(id) on delete cascade;

create index nodes_owner_idx on public.nodes(owner_id);

alter table public.nodes add constraint nodes_id_owner_unique unique (id, owner_id);
alter table public.servers drop constraint servers_node_id_fkey;
alter table public.servers
  add constraint servers_node_owner_fkey
  foreign key (node_id, owner_id) references public.nodes(id, owner_id)
  on delete set null (node_id);

create policy "owners read their host computers"
  on public.nodes for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "owners register host computers"
  on public.nodes for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "owners update their host computers"
  on public.nodes for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "owners remove their host computers"
  on public.nodes for delete to authenticated
  using (owner_id = (select auth.uid()));
