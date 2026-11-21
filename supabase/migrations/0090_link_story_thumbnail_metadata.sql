begin;

alter table public.articles
  add column if not exists thumbnail_asset_id uuid
    references public.newsroom_assets(id) on delete set null,
  add column if not exists thumbnail_alt_text text not null default ''
    check (length(thumbnail_alt_text) <= 500),
  add column if not exists thumbnail_credit_line text not null default ''
    check (length(thumbnail_credit_line) <= 200),
  add column if not exists thumbnail_license_name text not null default ''
    check (length(thumbnail_license_name) <= 160);

alter table public.article_revisions
  add column if not exists thumbnail_asset_id uuid,
  add column if not exists thumbnail_alt_text text not null default ''
    check (length(thumbnail_alt_text) <= 500),
  add column if not exists thumbnail_credit_line text not null default ''
    check (length(thumbnail_credit_line) <= 200),
  add column if not exists thumbnail_license_name text not null default ''
    check (length(thumbnail_license_name) <= 160);

create index if not exists articles_thumbnail_asset_idx
  on public.articles(thumbnail_asset_id)
  where thumbnail_asset_id is not null;

update public.articles article
set thumbnail_asset_id = asset.id,
    thumbnail_alt_text = coalesce(
      nullif(article.thumbnail_alt_text, ''),
      nullif(asset.alt_text, ''),
      article.title,
      ''
    ),
    thumbnail_credit_line = coalesce(nullif(asset.credit_line, ''), article.thumbnail_credit_line),
    thumbnail_license_name = coalesce(nullif(asset.license_name, ''), article.thumbnail_license_name)
from public.newsroom_assets asset
where article.thumbnail_url = asset.storage_path
  and article.thumbnail_asset_id is null;

create or replace function public.chowk_capture_article_revision_thumbnail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.thumbnail_url is null or new.thumbnail_alt_text = '' then
    select article.thumbnail_url, article.thumbnail_asset_id,
           article.thumbnail_alt_text, article.thumbnail_credit_line,
           article.thumbnail_license_name
    into new.thumbnail_url, new.thumbnail_asset_id,
         new.thumbnail_alt_text, new.thumbnail_credit_line,
         new.thumbnail_license_name
    from public.articles article
    where article.id = new.article_id;
  end if;
  return new;
end;
$$;

create or replace function public.chowk_set_article_thumbnail_metadata(
  target_article bigint,
  requested_alt_text text default '',
  requested_credit_line text default '',
  requested_license_name text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  article_path text;
  linked_asset_id uuid;
  asset_alt_text text;
  asset_credit_line text;
  asset_license_name text;
  resolved_alt_text text;
begin
  if length(trim(coalesce(requested_alt_text, ''))) > 500
     or length(trim(coalesce(requested_credit_line, ''))) > 200
     or length(trim(coalesce(requested_license_name, ''))) > 160 then
    raise exception 'Thumbnail metadata exceeds the allowed length'
      using errcode = '22023';
  end if;

  select article.thumbnail_url
  into article_path
  from public.articles article
  where article.id = target_article;

  if not found then
    raise exception 'Story not found'
      using errcode = 'P0002';
  end if;

  if article_path is null then
    update public.articles
    set thumbnail_asset_id = null,
        thumbnail_alt_text = '',
        thumbnail_credit_line = '',
        thumbnail_license_name = ''
    where id = target_article;
    return;
  end if;

  select asset.id, asset.alt_text, asset.credit_line, asset.license_name
  into linked_asset_id, asset_alt_text, asset_credit_line, asset_license_name
  from public.newsroom_assets asset
  where asset.storage_path = article_path
    and asset.asset_type in ('image', 'video_thumbnail');

  if not found then
    raise exception 'Thumbnail is not linked to an Asset Library item'
      using errcode = '22023';
  end if;

  resolved_alt_text := coalesce(
    nullif(trim(coalesce(requested_alt_text, '')), ''),
    nullif(trim(coalesce(asset_alt_text, '')), '')
  );
  if resolved_alt_text is null then
    raise exception 'Add alternative text for the story thumbnail'
      using errcode = '22023';
  end if;

  update public.articles
  set thumbnail_asset_id = linked_asset_id,
      thumbnail_alt_text = resolved_alt_text,
      thumbnail_credit_line = coalesce(
        nullif(trim(coalesce(requested_credit_line, '')), ''),
        trim(coalesce(asset_credit_line, ''))
      ),
      thumbnail_license_name = coalesce(
        nullif(trim(coalesce(requested_license_name, '')), ''),
        trim(coalesce(asset_license_name, ''))
      )
  where id = target_article;
end;
$$;

revoke all on function public.chowk_set_article_thumbnail_metadata(
  bigint, text, text, text
) from public, anon, authenticated;

create or replace function public.chowk_workspace_create_article_with_asset_thumbnail_v2(
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
  article_thumbnail_url text default null,
  article_thumbnail_alt_text text default '',
  article_thumbnail_credit_line text default '',
  article_thumbnail_license_name text default ''
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id bigint;
begin
  saved_id := public.chowk_workspace_create_article_with_asset_thumbnail(
    article_title, article_slug, article_excerpt, article_content, article_category_id,
    article_image_url, article_video_url, article_audio_url, article_reporting_location_id,
    article_content_type, article_news_priority, article_reporting_sources,
    article_reporting_evidence, article_contact_status, article_contact_notes,
    article_author_disclosure, article_breaking_review_note, article_thumbnail_url
  );
  perform public.chowk_set_article_thumbnail_metadata(
    saved_id, article_thumbnail_alt_text, article_thumbnail_credit_line,
    article_thumbnail_license_name
  );
  return saved_id;
end;
$$;

create or replace function public.chowk_workspace_update_article_with_asset_thumbnail_v2(
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
  article_thumbnail_url text default null,
  article_thumbnail_alt_text text default '',
  article_thumbnail_credit_line text default '',
  article_thumbnail_license_name text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.chowk_workspace_update_article_with_asset_thumbnail(
    target_article, article_title, article_slug, article_excerpt, article_content,
    article_category_id, article_image_url, article_video_url, article_audio_url,
    article_reporting_location_id, change_reason, article_content_type,
    article_news_priority, article_reporting_sources, article_reporting_evidence,
    article_contact_status, article_contact_notes, article_author_disclosure,
    article_breaking_review_note, article_thumbnail_url
  );
  perform public.chowk_set_article_thumbnail_metadata(
    target_article, article_thumbnail_alt_text, article_thumbnail_credit_line,
    article_thumbnail_license_name
  );
end;
$$;

revoke all on function public.chowk_workspace_create_article_with_asset_thumbnail_v2(
  text, text, text, text, bigint, text, text, text, bigint, text, text, text, text,
  text, text, text, text, text, text, text, text
) from public, anon;
revoke all on function public.chowk_workspace_update_article_with_asset_thumbnail_v2(
  bigint, text, text, text, text, bigint, text, text, text, bigint, text, text,
  text, text, text, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.chowk_workspace_create_article_with_asset_thumbnail_v2(
  text, text, text, text, bigint, text, text, text, bigint, text, text, text, text,
  text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.chowk_workspace_update_article_with_asset_thumbnail_v2(
  bigint, text, text, text, text, bigint, text, text, text, bigint, text, text,
  text, text, text, text, text, text, text, text, text, text, text
) to authenticated;

commit;
