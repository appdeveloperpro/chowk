begin;

alter table public.articles
  add column if not exists thumbnail_url text;

alter table public.article_revisions
  add column if not exists thumbnail_url text;

create table if not exists public.newsroom_assets (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique
    check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|avif|mp4|webm|mp3|m4a|ogg|wav)$'),
  asset_type text not null
    check (asset_type in ('image', 'video', 'audio', 'video_thumbnail')),
  title text not null check (length(trim(title)) between 1 and 160),
  alt_text text not null default '' check (length(alt_text) <= 500),
  description text not null default '' check (length(description) <= 1000),
  tags text[] not null default '{}'
    check (cardinality(tags) <= 20 and array_position(tags, null) is null),
  credit_line text not null default '' check (length(credit_line) <= 200),
  license_name text not null default '' check (length(license_name) <= 160),
  mime_type text not null
    check (mime_type in (
      'image/jpeg', 'image/png', 'image/webp', 'image/avif',
      'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4',
      'audio/ogg', 'audio/wav'
    )),
  file_size bigint not null check (file_size between 1 and 26214400),
  image_width integer check (image_width between 1 and 8192),
  image_height integer check (image_height between 1 and 8192),
  source_video_asset_id uuid references public.newsroom_assets(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (asset_type = 'video_thumbnail' and mime_type like 'image/%')
    or (asset_type = 'image' and mime_type like 'image/%')
    or (asset_type = 'video' and mime_type like 'video/%')
    or (asset_type = 'audio' and mime_type like 'audio/%')
  ),
  check (
    (source_video_asset_id is null and asset_type <> 'video_thumbnail')
    or asset_type = 'video_thumbnail'
  )
);

create index if not exists newsroom_assets_active_created_idx
  on public.newsroom_assets(status, created_at desc);
create index if not exists newsroom_assets_type_created_idx
  on public.newsroom_assets(asset_type, status, created_at desc);
create index if not exists newsroom_assets_tags_idx
  on public.newsroom_assets using gin(tags);

create or replace function public.chowk_validate_asset_source_video()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_video_asset_id is not null and not exists (
    select 1 from public.newsroom_assets source_asset
    where source_asset.id = new.source_video_asset_id
      and source_asset.asset_type = 'video'
  ) then
    raise exception 'Thumbnail source must be a video asset'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_newsroom_assets_validate_source_video on public.newsroom_assets;
create trigger chowk_newsroom_assets_validate_source_video
before insert or update of source_video_asset_id, asset_type on public.newsroom_assets
for each row execute function public.chowk_validate_asset_source_video();

drop trigger if exists chowk_newsroom_assets_set_updated_at on public.newsroom_assets;
create trigger chowk_newsroom_assets_set_updated_at
before update on public.newsroom_assets
for each row execute function public.chowk_set_updated_at();

alter table public.newsroom_assets enable row level security;
revoke all on public.newsroom_assets from public, anon, authenticated;

drop policy if exists "Newsroom staff read asset library" on public.newsroom_assets;
create policy "Newsroom staff read asset library"
on public.newsroom_assets for select to authenticated
using ((select public.chowk_org_user_has_capability('newsroom.media.manage')));

drop policy if exists "Newsroom staff add owned assets" on public.newsroom_assets;
create policy "Newsroom staff add owned assets"
on public.newsroom_assets for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (storage.foldername(storage_path))[1] = (select auth.uid())::text
  and (select public.chowk_org_user_has_capability('newsroom.media.manage'))
);

drop policy if exists "Newsroom staff update asset metadata" on public.newsroom_assets;
create policy "Newsroom staff update asset metadata"
on public.newsroom_assets for update to authenticated
using ((select public.chowk_org_user_has_capability('newsroom.media.manage')))
with check ((select public.chowk_org_user_has_capability('newsroom.media.manage')));

grant select on public.newsroom_assets to authenticated;
grant insert (
  storage_path, asset_type, title, alt_text, description, tags, credit_line,
  license_name, mime_type, file_size, image_width, image_height,
  source_video_asset_id, created_by, status, archived_at
) on public.newsroom_assets to authenticated;
grant update (
  title, alt_text, description, tags, credit_line, license_name, status, archived_at
) on public.newsroom_assets to authenticated;

create or replace function public.chowk_capture_article_revision_thumbnail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.thumbnail_url is null then
    select article.thumbnail_url
    into new.thumbnail_url
    from public.articles article
    where article.id = new.article_id;
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_article_revision_capture_thumbnail on public.article_revisions;
create trigger chowk_article_revision_capture_thumbnail
before insert on public.article_revisions
for each row execute function public.chowk_capture_article_revision_thumbnail();

create or replace function public.chowk_workspace_create_article_with_asset_thumbnail(
  article_title text,
  article_slug text,
  article_excerpt text default '',
  article_content text default '',
  article_category_id bigint default null,
  article_image_url text default null,
  article_video_url text default null,
  article_audio_url text default null,
  article_reporting_location_id bigint default null,
  article_content_type text default 'news',
  article_news_priority text default 'routine',
  article_reporting_sources text default '',
  article_reporting_evidence text default '',
  article_contact_status text default null,
  article_contact_notes text default '',
  article_author_disclosure text default '',
  article_breaking_review_note text default '',
  article_thumbnail_url text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id bigint;
begin
  if article_thumbnail_url is not null and (
    not public.chowk_org_user_has_capability('newsroom.media.manage')
    or not exists (
      select 1 from public.newsroom_assets asset
      where asset.storage_path = article_thumbnail_url
        and asset.asset_type in ('image', 'video_thumbnail')
        and asset.status = 'active'
    )
  ) then
    raise exception 'Choose an active image from the Asset Library'
      using errcode = '42501';
  end if;

  saved_id := public.chowk_workspace_create_article_with_metadata(
    article_title, article_slug, article_excerpt, article_content, article_category_id,
    article_image_url, article_video_url, article_audio_url, article_reporting_location_id,
    article_content_type, article_news_priority, article_reporting_sources,
    article_reporting_evidence, article_contact_status, article_contact_notes,
    article_author_disclosure, article_breaking_review_note
  );
  update public.articles
  set thumbnail_url = article_thumbnail_url
  where id = saved_id;
  return saved_id;
end;
$$;

create or replace function public.chowk_workspace_update_article_with_asset_thumbnail(
  target_article bigint,
  article_title text,
  article_slug text,
  article_excerpt text default '',
  article_content text default '',
  article_category_id bigint default null,
  article_image_url text default null,
  article_video_url text default null,
  article_audio_url text default null,
  article_reporting_location_id bigint default null,
  change_reason text default '',
  article_content_type text default 'news',
  article_news_priority text default 'routine',
  article_reporting_sources text default '',
  article_reporting_evidence text default '',
  article_contact_status text default null,
  article_contact_notes text default '',
  article_author_disclosure text default '',
  article_breaking_review_note text default '',
  article_thumbnail_url text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_thumbnail_url text;
begin
  select article.thumbnail_url
  into previous_thumbnail_url
  from public.articles article
  where article.id = target_article
  for update;

  if article_thumbnail_url is not null
     and article_thumbnail_url is distinct from previous_thumbnail_url
     and (
       not public.chowk_org_user_has_capability('newsroom.media.manage')
       or not exists (
         select 1 from public.newsroom_assets asset
         where asset.storage_path = article_thumbnail_url
           and asset.asset_type in ('image', 'video_thumbnail')
           and asset.status = 'active'
       )
     ) then
    raise exception 'Choose an active image from the Asset Library'
      using errcode = '42501';
  end if;

  perform public.chowk_workspace_update_article_with_metadata(
    target_article, article_title, article_slug, article_excerpt, article_content,
    article_category_id, article_image_url, article_video_url, article_audio_url,
    article_reporting_location_id, change_reason, article_content_type,
    article_news_priority, article_reporting_sources, article_reporting_evidence,
    article_contact_status, article_contact_notes, article_author_disclosure,
    article_breaking_review_note
  );
  update public.articles
  set thumbnail_url = article_thumbnail_url
  where id = target_article;
end;
$$;

revoke all on function public.chowk_workspace_create_article_with_asset_thumbnail(
  text, text, text, text, bigint, text, text, text, bigint, text, text, text, text,
  text, text, text, text, text
) from public, anon;
revoke all on function public.chowk_workspace_update_article_with_asset_thumbnail(
  bigint, text, text, text, text, bigint, text, text, text, bigint, text, text,
  text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.chowk_workspace_create_article_with_asset_thumbnail(
  text, text, text, text, bigint, text, text, text, bigint, text, text, text, text,
  text, text, text, text, text
) to authenticated;
grant execute on function public.chowk_workspace_update_article_with_asset_thumbnail(
  bigint, text, text, text, text, bigint, text, text, text, bigint, text, text,
  text, text, text, text, text, text, text, text
) to authenticated;

create or replace function public.chowk_newsroom_media_is_referenced(target_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.newsroom_assets asset
    where asset.storage_path = target_path
  ) or exists (
    select 1 from public.articles article
    where article.image_url = target_path
      or article.thumbnail_url = target_path
      or article.video_url = target_path
      or article.audio_url = target_path
  );
$$;

revoke all on function public.chowk_newsroom_media_is_referenced(text) from public, anon;
grant execute on function public.chowk_newsroom_media_is_referenced(text) to authenticated;

drop policy if exists "Newsroom staff delete owned media" on storage.objects;
create policy "Newsroom staff delete owned media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'chowk-newsroom'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.chowk_has_any_role(
    array['reporter', 'moderator', 'editor', 'publisher', 'admin', 'super_admin']
  ))
  and not (select public.chowk_newsroom_media_is_referenced(name))
);

drop policy if exists "Newsroom media is readable when referenced" on storage.objects;
create policy "Newsroom media is readable when referenced"
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'chowk-newsroom'
  and (
    (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and (select public.chowk_has_any_role(
        array['reporter', 'moderator', 'editor', 'publisher', 'admin', 'super_admin']
      ))
    )
    or exists (
      select 1 from public.articles article
      where (
        article.image_url = storage.objects.name
        or article.thumbnail_url = storage.objects.name
        or article.video_url = storage.objects.name
        or article.audio_url = storage.objects.name
      )
      and (
        (article.status = 'published' and article.published_at is not null and article.published_at <= now())
        or (
          (select auth.role()) = 'authenticated'
          and (select public.chowk_has_any_role(
            array['moderator', 'editor', 'publisher', 'admin', 'super_admin']
          ))
        )
      )
    )
    or (
      (select auth.role()) = 'authenticated'
      and (select public.chowk_org_user_has_capability('newsroom.media.manage'))
      and exists (
        select 1 from public.newsroom_assets asset
        where asset.storage_path = storage.objects.name
      )
    )
  )
);

commit;
