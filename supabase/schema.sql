-- AI Tip cloud account data. Model/Tavily credentials and local settings are
-- intentionally excluded from this schema and remain device-local.

create table if not exists public.ai_documents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  source_path text,
  updated_at timestamptz not null default now(),
  constraint ai_documents_id_user_unique unique (id, user_id),
  constraint ai_documents_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint ai_documents_payload_identity check (
    payload ->> 'id' = id::text and payload ->> 'userId' = user_id::text
  ),
  constraint ai_documents_source_owned check (
    source_path is null or source_path like user_id::text || '/%'
  )
);

create table if not exists public.ai_tips (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint ai_tips_document_owner_fk foreign key (document_id, user_id)
    references public.ai_documents(id, user_id) on delete cascade,
  constraint ai_tips_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint ai_tips_payload_identity check (
    payload ->> 'id' = id::text
    and payload ->> 'userId' = user_id::text
    and payload ->> 'documentId' = document_id::text
  )
);

create index if not exists ai_documents_user_updated_idx
  on public.ai_documents (user_id, updated_at desc);
create index if not exists ai_tips_user_document_updated_idx
  on public.ai_tips (user_id, document_id, updated_at desc);
create index if not exists ai_tips_document_owner_fk_idx
  on public.ai_tips (document_id, user_id);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.ai_tip_current_cloud_bytes(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(octet_length(d.payload::text)) from public.ai_documents d where d.user_id = p_user_id), 0)::bigint
    + coalesce((select sum(octet_length(t.payload::text)) from public.ai_tips t where t.user_id = p_user_id), 0)::bigint
    + coalesce((select sum(coalesce((o.metadata ->> 'size')::bigint, 0)) from storage.objects o where o.bucket_id = 'ai-document-files' and (storage.foldername(o.name))[1] = p_user_id::text), 0)::bigint
  where (select auth.uid()) = p_user_id;
$$;
revoke all on function private.ai_tip_current_cloud_bytes(uuid) from public, anon;
grant execute on function private.ai_tip_current_cloud_bytes(uuid) to authenticated;

create or replace function private.ai_tip_enforce_row_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_total bigint;
  v_old_bytes bigint := 0;
  v_new_bytes bigint := octet_length(new.payload::text);
begin
  if v_uid is null or new.user_id <> v_uid then
    raise exception 'AI_TIP_CLOUD_OWNER_MISMATCH' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 824624));
  if tg_op = 'UPDATE' then v_old_bytes := octet_length(old.payload::text); end if;
  v_total := private.ai_tip_current_cloud_bytes(new.user_id) - v_old_bytes + v_new_bytes;
  if v_total > 5242880 then
    raise exception 'AI_TIP_CLOUD_QUOTA_EXCEEDED: % of 5242880 bytes', v_total using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.ai_tip_enforce_row_quota() from public, anon, authenticated;

drop trigger if exists ai_documents_cloud_quota on public.ai_documents;
create trigger ai_documents_cloud_quota before insert or update of payload, user_id on public.ai_documents
for each row execute function private.ai_tip_enforce_row_quota();
drop trigger if exists ai_tips_cloud_quota on public.ai_tips;
create trigger ai_tips_cloud_quota before insert or update of payload, user_id on public.ai_tips
for each row execute function private.ai_tip_enforce_row_quota();

create or replace function private.ai_tip_storage_upload_within_quota(p_bucket_id text, p_name text, p_metadata jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_size bigint;
  v_used bigint;
begin
  if v_uid is null or p_bucket_id <> 'ai-document-files' or (storage.foldername(p_name))[1] <> v_uid::text then return false; end if;
  begin v_size := (p_metadata ->> 'size')::bigint; exception when others then return false; end;
  if v_size < 0 or v_size > 5242880 then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 824624));
  select private.ai_tip_current_cloud_bytes(v_uid)
    - coalesce((select coalesce((o.metadata ->> 'size')::bigint, 0) from storage.objects o where o.bucket_id = p_bucket_id and o.name = p_name), 0)
    + v_size into v_used;
  return v_used <= 5242880;
end;
$$;
revoke all on function private.ai_tip_storage_upload_within_quota(text, text, jsonb) from public, anon;
grant execute on function private.ai_tip_storage_upload_within_quota(text, text, jsonb) to authenticated;

create or replace function public.ai_tip_cloud_usage()
returns table(used_bytes bigint, limit_bytes bigint, storage_bytes bigint, database_bytes bigint, object_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    private.ai_tip_current_cloud_bytes((select auth.uid())) as used_bytes,
    5242880::bigint as limit_bytes,
    coalesce((select sum(coalesce((o.metadata ->> 'size')::bigint, 0)) from storage.objects o where o.bucket_id = 'ai-document-files' and (storage.foldername(o.name))[1] = (select auth.uid())::text), 0)::bigint as storage_bytes,
    (coalesce((select sum(octet_length(d.payload::text)) from public.ai_documents d where d.user_id = (select auth.uid())), 0)
      + coalesce((select sum(octet_length(t.payload::text)) from public.ai_tips t where t.user_id = (select auth.uid())), 0))::bigint as database_bytes,
    (select count(*) from storage.objects o where o.bucket_id = 'ai-document-files' and (storage.foldername(o.name))[1] = (select auth.uid())::text)::bigint as object_count;
$$;
revoke all on function public.ai_tip_cloud_usage() from public, anon;
grant execute on function public.ai_tip_cloud_usage() to authenticated;

alter table public.ai_documents enable row level security;
alter table public.ai_tips enable row level security;

revoke all on table public.ai_documents from anon, authenticated;
revoke all on table public.ai_tips from anon, authenticated;
grant select, insert, update, delete on table public.ai_documents to authenticated;
grant select, insert, update, delete on table public.ai_tips to authenticated;

drop policy if exists "ai_documents_select_own" on public.ai_documents;
drop policy if exists "ai_documents_insert_own" on public.ai_documents;
drop policy if exists "ai_documents_update_own" on public.ai_documents;
drop policy if exists "ai_documents_delete_own" on public.ai_documents;
create policy "ai_documents_select_own" on public.ai_documents
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "ai_documents_insert_own" on public.ai_documents
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "ai_documents_update_own" on public.ai_documents
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "ai_documents_delete_own" on public.ai_documents
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "ai_tips_select_own" on public.ai_tips;
drop policy if exists "ai_tips_insert_own" on public.ai_tips;
drop policy if exists "ai_tips_update_own" on public.ai_tips;
drop policy if exists "ai_tips_delete_own" on public.ai_tips;
create policy "ai_tips_select_own" on public.ai_tips
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "ai_tips_insert_own" on public.ai_tips
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "ai_tips_update_own" on public.ai_tips
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "ai_tips_delete_own" on public.ai_tips
  for delete to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ai-document-files',
  'ai-document-files',
  false,
  5242880,
  array[
    'text/plain',
    'text/markdown',
    'application/octet-stream',
    'application/gzip',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ai_document_files_select_own" on storage.objects;
drop policy if exists "ai_document_files_insert_own" on storage.objects;
drop policy if exists "ai_document_files_update_own" on storage.objects;
drop policy if exists "ai_document_files_delete_own" on storage.objects;
create policy "ai_document_files_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'ai-document-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "ai_document_files_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ai-document-files' and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.ai_tip_storage_upload_within_quota(bucket_id, name, metadata));
create policy "ai_document_files_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'ai-document-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'ai-document-files' and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.ai_tip_storage_upload_within_quota(bucket_id, name, metadata));
create policy "ai_document_files_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'ai-document-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
