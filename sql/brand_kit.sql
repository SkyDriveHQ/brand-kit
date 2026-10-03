-- =============================================================================================
-- @skydrivehq/brand-kit — reference migration (v0.1.0)
--
--   *** UNTESTED. This file has never been applied to any database. It was written carefully, ***
--   *** but nobody has run it. Apply it to a branch or a local stack first, and run the checks ***
--   *** at the bottom of this header before it goes near a live project.                      ***
--
-- A product COPIES this file into its own supabase/migrations/ and EDITS it. It is a template,
-- not something to run as is: it will not even parse until the placeholders are replaced.
--
-- ── PLACEHOLDERS: search for "REPLACE" ──────────────────────────────────────────────────────
--   :tenant_table       the table of tenants (dropzones, sites, shops). Its key column is assumed
--                       to be `id`; change `(id)` / `t.id` below if it is not.
--   :tenant_id_type     that key's type, e.g. uuid.
--   :can_edit_tenant(x) a boolean expression: may the signed-in user change tenant x's branding?
--   :can_read_tenant(x) a boolean expression: may the signed-in user see tenant x's branding?
--   The two checks are each written ONCE, inside private.brand_kit_can_edit / _can_read below;
--   everything else calls those two functions.
--   These are NOT psql variables (psql would not substitute inside $$ function bodies). Replace
--   them by hand.
--
--   Worked example, SkyWeather (supabase/migrations/20261001130300_rls_and_grants.sql):
--     :tenant_table       -> public.sites
--     :tenant_id_type     -> uuid
--     :can_edit_tenant(x) -> exists (select 1 from public.site_members m
--                                     where m.site_id = x
--                                       and m.user_id = (select auth.uid())
--                                       and m.role in ('owner', 'admin'))
--     :can_read_tenant(x) -> x in (select private.member_site_ids())
--
-- ── THE SECURITY MODEL ───────────────────────────────────────────────────────────────────────
--   * A kit is never edited in place. A tenant has at most ONE draft (partial unique index) and
--     any number of PUBLISHED versions, which never change (trigger). The live kit is a pointer
--     (brand_kit_live) to one published version, so a rollback is a pointer change.
--   * Publish and rollback are `security definer` rpcs that check the caller's right to edit
--     the tenant, with `set search_path = ''`.
--   * Bucket `brand-assets` (PUBLIC) holds the PNG renditions, at
--     {tenant}/{version}/{sha256}.png. Anyone can read them by URL (emails need permanent public
--     addresses). Editors may INSERT only under their own tenant's folder AND only into a
--     folder whose version is still a draft. There is NO update policy: a file is never
--     overwritten. DELETE is allowed only under a draft's folder, so a file a published kit
--     (and therefore a sent email) uses can never be deleted from the browser.
--   * Bucket `brand-originals` (PRIVATE) holds the customer's original files, including SVG,
--     which is never served publicly, and brand-guide PDFs. Members read; editors insert
--     (draft folders only) and may delete under a draft's folder (discarding a draft); no update.
--
-- ── DIFFERENCE FROM SKYWEATHER'S OWN RULE, on purpose ──────────────────────────────────────
--   SkyWeather's migrations grant `authenticated` NO write policies at all: every write goes
--   through its `api` edge function as the service role. The brand-kit store
--   (`supabaseBrandStore`) writes from the browser, so this template DOES give editors narrow
--   write policies (draft rows, draft folders). A product that keeps SkyWeather's rule should
--   delete the insert/update/delete policies and grants marked "BROWSER WRITE" and route the
--   store's writes through its own function instead.
--
-- ── WHAT THE DATABASE DOES NOT CHECK (known gaps) ───────────────────────────────────────────
--   * The kit JSON's CONTENTS. SQL cannot run `parseKit`; the table only checks it is an object
--     under 64 KB. The store validates strictly before saving and before publishing, but a
--     tampered browser can call PostgREST directly. A product that needs a server-side check
--     publishes through an edge function that runs `publishProblems(version, rules)` (core runs
--     in Deno) and then calls brand_kit_publish.
--   * The PNG BYTES. The bucket allows only image/png up to 2 MB, but the content type is what
--     the uploader says. Research §4.3 recommends an edge function that re-checks each upload
--     with `checkPng` (core) and ideally re-encodes it.
--   * The 5 MB limit on logo originals. `brand-originals` holds guides too, so its bucket limit
--     is the guide limit (25 MB); the 5 MB logo limit is enforced in the browser only.
--
-- ── CHECKS TO RUN after applying (none has been run) ────────────────────────────────────────
--   1. An editor of tenant A can create one draft, a second insert fails (23505).
--   2. Updating or deleting a published row fails, as an editor AND as the service role.
--   3. brand_kit_publish / brand_kit_rollback refuse a user who cannot edit the tenant.
--   4. Upload to brand-assets under tenant B's folder fails; under A's PUBLISHED version folder
--      fails; under A's draft folder succeeds; the same upload again fails (no overwrite).
--   5. Delete from brand-assets under a published version's folder fails.
--   6. A signed-out request can fetch a brand-assets public URL, and cannot list the bucket.
--   7. A non-member cannot read brand-originals or either table.
--
-- Defaults match the package: DEFAULT_BUCKETS, UPLOAD_LIMITS and RENDITION sizes in
-- src/core/kit.ts, and the paths in src/core/paths.ts. Change them together or not at all.
-- =============================================================================================


-- ── 0. The private schema (not exposed by the API) ──────────────────────────────────────────
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;


-- ── 1. Permission checks: THE ONLY PLACE TO EDIT THEM ───────────────────────────────────────
-- SECURITY DEFINER so a check that reads a membership table is not itself subject to that
-- table's RLS (which would recurse, as SkyWeather's comment on member_site_ids explains).
-- A null tenant id must give false: the storage policies pass null for a folder that is not a
-- tenant.

-- REPLACE :tenant_id_type and :can_edit_tenant(p_tenant_id)
create or replace function private.brand_kit_can_edit(p_tenant_id :tenant_id_type)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tenant_id is not null and coalesce((:can_edit_tenant(p_tenant_id)), false);
$$;

-- REPLACE :tenant_id_type and :can_read_tenant(p_tenant_id)
create or replace function private.brand_kit_can_read(p_tenant_id :tenant_id_type)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tenant_id is not null and coalesce((:can_read_tenant(p_tenant_id)), false);
$$;

revoke all on function private.brand_kit_can_edit(:tenant_id_type) from public, anon;  -- REPLACE :tenant_id_type
revoke all on function private.brand_kit_can_read(:tenant_id_type) from public, anon;  -- REPLACE :tenant_id_type
grant execute on function private.brand_kit_can_edit(:tenant_id_type) to authenticated; -- REPLACE :tenant_id_type
grant execute on function private.brand_kit_can_read(:tenant_id_type) to authenticated; -- REPLACE :tenant_id_type


-- ── 2. Tables ────────────────────────────────────────────────────────────────────────────────
create table public.brand_kit_versions (
  id           uuid primary key default gen_random_uuid(),
  -- REPLACE :tenant_id_type and :tenant_table (and `(id)` if its key is named differently)
  tenant_id    :tenant_id_type not null references :tenant_table (id) on delete cascade,
  state        text not null default 'draft' check (state in ('draft', 'published')),
  -- A validated BrandKit (src/core/kit.ts), schemaVersion inside. Logos are kilobytes of
  -- metadata here; the images themselves are in storage.
  kit          jsonb not null default '{"schemaVersion":1,"logos":{},"colors":{},"fonts":{}}'::jsonb
               check (jsonb_typeof(kit) = 'object' and octet_length(kit::text) <= 65536),
  -- The published version this draft started from. Same tenant, by the composite key below.
  based_on     uuid,
  created_at   timestamptz not null default now(),
  -- User ids are plain uuids with no foreign key (users may live in a shared identity project,
  -- as SkyWeather's do).
  created_by   uuid default auth.uid(),
  published_at timestamptz,
  published_by uuid,
  constraint brand_kit_versions_published_has_time check ((state = 'published') = (published_at is not null)),
  constraint brand_kit_versions_id_tenant_key unique (id, tenant_id)
);

-- Added after the table so the unique key it points at certainly exists. MATCH SIMPLE: a null
-- `based_on` (a first draft) is not checked. No ON DELETE action: published versions are never
-- deleted except in a full purge, which deletes the whole chain in one statement.
alter table public.brand_kit_versions
  add constraint brand_kit_versions_based_on_fkey foreign key (based_on, tenant_id)
    references public.brand_kit_versions (id, tenant_id);

-- At most one draft per tenant.
create unique index brand_kit_versions_one_draft_idx
  on public.brand_kit_versions (tenant_id) where state = 'draft';
-- Version history, newest first.
create index brand_kit_versions_published_idx
  on public.brand_kit_versions (tenant_id, published_at desc) where state = 'published';

create table public.brand_kit_live (
  -- REPLACE :tenant_id_type and :tenant_table
  tenant_id  :tenant_id_type primary key references :tenant_table (id) on delete cascade,
  version_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  -- The live version belongs to the same tenant. That it is PUBLISHED is checked by trigger.
  constraint brand_kit_live_version_fkey foreign key (version_id, tenant_id)
    references public.brand_kit_versions (id, tenant_id) on delete cascade
);


-- ── 3. Published versions never change ──────────────────────────────────────────────────────
-- Applies to everyone, the service role included. The one exception is deleting a tenant's
-- whole history when the business leaves (research §9.4): that job runs
--   set local brand_kit.allow_purge = 'on';
-- in its transaction first. Deleting a tenant row cascades here, so it needs the same setting.
create or replace function private.brand_kit_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.state = 'published' and coalesce(current_setting('brand_kit.allow_purge', true), '') <> 'on' then
      raise exception 'brand kit version % is published and is kept for good', old.id
        using errcode = '55000',
              hint = 'Emails already sent may show its logo. Only a full account purge may delete it.';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.state = 'published' then
    raise exception 'brand kit version % is published and cannot be changed', old.id
      using errcode = '55000', hint = 'Start a new draft instead.';
  end if;
  if new.id <> old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.based_on is distinct from old.based_on
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'only a draft''s kit can be changed' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger brand_kit_versions_guard
  before update or delete on public.brand_kit_versions
  for each row execute function private.brand_kit_versions_guard();

create or replace function private.brand_kit_live_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.brand_kit_versions v
     where v.id = new.version_id and v.tenant_id = new.tenant_id and v.state = 'published'
  ) then
    raise exception 'the live brand kit must be a published version of the same tenant'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger brand_kit_live_guard
  before insert or update on public.brand_kit_live
  for each row execute function private.brand_kit_live_guard();


-- ── 4. Row-level security and grants ────────────────────────────────────────────────────────
alter table public.brand_kit_versions enable row level security;
alter table public.brand_kit_live     enable row level security;

-- Start from nothing (Supabase grants ALL on new public tables by default), then grant back.
revoke all on public.brand_kit_versions, public.brand_kit_live from anon, authenticated;
grant select on public.brand_kit_versions, public.brand_kit_live to authenticated;
-- BROWSER WRITE: only these columns. `state`, `published_*` and `created_*` cannot be written by
-- a client at all, so a draft becomes published only through brand_kit_publish.
grant insert (tenant_id, kit, based_on) on public.brand_kit_versions to authenticated;
grant update (kit)                      on public.brand_kit_versions to authenticated;
grant delete                            on public.brand_kit_versions to authenticated;
-- brand_kit_live: no write grant. Only the rpcs (as owner) write it.

-- Editors see drafts and history; other members see published versions only.
create policy brand_kit_versions_read on public.brand_kit_versions
  for select to authenticated
  using (private.brand_kit_can_edit(tenant_id)
         or (state = 'published' and private.brand_kit_can_read(tenant_id)));

-- BROWSER WRITE
create policy brand_kit_versions_insert_draft on public.brand_kit_versions
  for insert to authenticated
  with check (state = 'draft' and private.brand_kit_can_edit(tenant_id));

-- BROWSER WRITE
create policy brand_kit_versions_update_draft on public.brand_kit_versions
  for update to authenticated
  using (state = 'draft' and private.brand_kit_can_edit(tenant_id))
  with check (state = 'draft' and private.brand_kit_can_edit(tenant_id));

-- BROWSER WRITE
create policy brand_kit_versions_delete_draft on public.brand_kit_versions
  for delete to authenticated
  using (state = 'draft' and private.brand_kit_can_edit(tenant_id));

create policy brand_kit_live_read on public.brand_kit_live
  for select to authenticated
  using (private.brand_kit_can_read(tenant_id));


-- ── 5. Publish and rollback ─────────────────────────────────────────────────────────────────
-- Parameter names are part of the API: supabase-js calls rpc('brand_kit_publish', { draft_id })
-- and rpc('brand_kit_rollback', { version_id }). "Not found" and "not yours" give the same error,
-- so the rpc cannot be used to probe for other tenants' version ids.
create or replace function public.brand_kit_publish(draft_id uuid)
returns public.brand_kit_versions
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v public.brand_kit_versions;
begin
  select * into v
    from public.brand_kit_versions
   where id = brand_kit_publish.draft_id
     for update;
  if not found or not private.brand_kit_can_edit(v.tenant_id) then
    raise exception 'brand kit draft not found, or not yours to publish' using errcode = '42501';
  end if;
  if v.state <> 'draft' then
    raise exception 'only a draft can be published' using errcode = '55000';
  end if;

  update public.brand_kit_versions
     set state = 'published', published_at = now(), published_by = (select auth.uid())
   where id = v.id
  returning * into v;

  insert into public.brand_kit_live (tenant_id, version_id, updated_at, updated_by)
  values (v.tenant_id, v.id, now(), (select auth.uid()))
  on conflict (tenant_id) do update
     set version_id = excluded.version_id,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by;

  return v;
end;
$$;

create or replace function public.brand_kit_rollback(version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v public.brand_kit_versions;
begin
  select * into v
    from public.brand_kit_versions
   where id = brand_kit_rollback.version_id;
  if not found or not private.brand_kit_can_edit(v.tenant_id) then
    raise exception 'brand kit version not found, or not yours to change' using errcode = '42501';
  end if;
  if v.state <> 'published' then
    raise exception 'only a published version can be made live' using errcode = '55000';
  end if;

  insert into public.brand_kit_live (tenant_id, version_id, updated_at, updated_by)
  values (v.tenant_id, v.id, now(), (select auth.uid()))
  on conflict (tenant_id) do update
     set version_id = excluded.version_id,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by;
end;
$$;

-- The live kit for a page to draw: { versionId, kit } or null. Published by construction.
-- Signed-in members only by default. A public page (a booking page, a TV board without a login)
-- needs it for signed-out visitors: uncomment the `anon` grant, or serve it from an edge function.
-- REPLACE :tenant_id_type
create or replace function public.brand_kit_live_kit(p_tenant_id :tenant_id_type)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('versionId', v.id, 'kit', v.kit)
    from public.brand_kit_live l
    join public.brand_kit_versions v on v.id = l.version_id and v.tenant_id = l.tenant_id
   where l.tenant_id = p_tenant_id;
$$;

revoke all on function public.brand_kit_publish(uuid)  from public, anon;
revoke all on function public.brand_kit_rollback(uuid) from public, anon;
revoke all on function public.brand_kit_live_kit(:tenant_id_type) from public, anon;   -- REPLACE :tenant_id_type
grant execute on function public.brand_kit_publish(uuid)  to authenticated;
grant execute on function public.brand_kit_rollback(uuid) to authenticated;
grant execute on function public.brand_kit_live_kit(:tenant_id_type) to authenticated; -- REPLACE :tenant_id_type
-- grant execute on function public.brand_kit_live_kit(:tenant_id_type) to anon;       -- public pages


-- ── 6. Buckets ──────────────────────────────────────────────────────────────────────────────
-- Limits from UPLOAD_LIMITS (src/core/kit.ts):
--   renditionMaxBytes 2 MiB  = 2097152   (brand-assets)
--   guideMaxBytes     25 MiB = 26214400  (brand-originals: guides AND logo originals, see header)
-- Content types are sent without a charset parameter; a `; charset=` suffix is reported to be
-- refused by allowed_mime_types (unverified, research §9.2).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('brand-assets',    'brand-assets',    true,  2097152,  array['image/png']),
  ('brand-originals', 'brand-originals', false, 26214400,
     array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf'])
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;


-- ── 7. Storage helpers: which tenant and which version a stored object is under ──────────────
-- Object names are {tenant}/{version}/{file}; storage.foldername(name) gives {tenant, version}.

-- The tenant an object's first folder names, or null. Compared as text, so a folder that is not
-- a valid id gives null instead of a cast error. (For uuid tenant ids, a regex-guarded cast like
-- the one in brand_kit_object_in_draft would let this use the tenant table's index.)
-- REPLACE :tenant_id_type and :tenant_table (and `t.id`)
create or replace function private.brand_kit_object_tenant(object_name text)
returns :tenant_id_type
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
    from :tenant_table t
   where t.id::text = (storage.foldername(object_name))[1];
$$;

-- True when the object's second folder is a DRAFT version of the tenant its first folder names.
create or replace function private.brand_kit_object_in_draft(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.brand_kit_versions v
     where v.state = 'draft'
       and v.id = case
                    when (storage.foldername(object_name))[2]
                         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then ((storage.foldername(object_name))[2])::uuid
                  end
       and v.tenant_id::text = (storage.foldername(object_name))[1]
  );
$$;

revoke all on function private.brand_kit_object_tenant(text)   from public, anon;
revoke all on function private.brand_kit_object_in_draft(text) from public, anon;
grant execute on function private.brand_kit_object_tenant(text)   to authenticated;
grant execute on function private.brand_kit_object_in_draft(text) to authenticated;


-- ── 8. Storage policies ─────────────────────────────────────────────────────────────────────
-- RLS on storage.objects is already enabled by Supabase. There is NO update policy on either
-- bucket, so nothing is ever overwritten (an upsert needs update; the store never upserts).

-- brand-assets (public). Reads by URL need no policy: the public endpoint serves them. This
-- select policy only lets an editor LIST their own tenant's files (needed to discard a draft).
create policy brand_assets_editor_list on storage.objects
  for select to authenticated
  using (bucket_id = 'brand-assets'
         and private.brand_kit_can_edit(private.brand_kit_object_tenant(name)));

-- BROWSER WRITE: {tenant}/{draft version uuid}/{64 hex}.png, into a draft of a tenant you edit.
create policy brand_assets_insert_draft on storage.objects
  for insert to authenticated
  with check (bucket_id = 'brand-assets'
              and name ~ '^[A-Za-z0-9_-]{1,128}/[0-9a-f-]{36}/[0-9a-f]{64}\.png$'
              and private.brand_kit_can_edit(private.brand_kit_object_tenant(name))
              and private.brand_kit_object_in_draft(name));

-- BROWSER WRITE: only under a draft's folder. A published version's files are kept.
create policy brand_assets_delete_draft on storage.objects
  for delete to authenticated
  using (bucket_id = 'brand-assets'
         and private.brand_kit_can_edit(private.brand_kit_object_tenant(name))
         and private.brand_kit_object_in_draft(name));

-- brand-originals (private): members read.
create policy brand_originals_member_read on storage.objects
  for select to authenticated
  using (bucket_id = 'brand-originals'
         and private.brand_kit_can_read(private.brand_kit_object_tenant(name)));

-- BROWSER WRITE: original-{64 hex}.{ext} or guide-{64 hex}.pdf, into a draft of a tenant you edit.
create policy brand_originals_insert_draft on storage.objects
  for insert to authenticated
  with check (bucket_id = 'brand-originals'
              and name ~ '^[A-Za-z0-9_-]{1,128}/[0-9a-f-]{36}/(original-[0-9a-f]{64}\.(png|jpg|jpeg|webp|svg)|guide-[0-9a-f]{64}\.pdf)$'
              and private.brand_kit_can_edit(private.brand_kit_object_tenant(name))
              and private.brand_kit_object_in_draft(name));

-- BROWSER WRITE: discarding a draft removes its originals too.
create policy brand_originals_delete_draft on storage.objects
  for delete to authenticated
  using (bucket_id = 'brand-originals'
         and private.brand_kit_can_edit(private.brand_kit_object_tenant(name))
         and private.brand_kit_object_in_draft(name));
