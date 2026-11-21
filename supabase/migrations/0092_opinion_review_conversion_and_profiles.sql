begin;

alter table public.opinion_submissions
  add column if not exists submission_reference text,
  add column if not exists topic text not null default ''
    check (length(topic) <= 160),
  add column if not exists consent_at timestamptz,
  add column if not exists ip_hash text,
  add column if not exists user_agent text not null default ''
    check (length(user_agent) <= 500);

create unique index if not exists opinion_submissions_submission_reference_unique
  on public.opinion_submissions(submission_reference)
  where submission_reference is not null;

alter table public.newsroom_contributors
  add column if not exists photo_url text not null default ''
    check (length(photo_url) <= 2000);

alter table public.article_revisions
  add column if not exists fact_sources text,
  add column if not exists ai_use_disclosure text;

create or replace function public.chowk_submit_reader_opinion_v2(
  submitted_name text,
  submitted_email text,
  submitted_phone text default '',
  submitted_headline text default '',
  submitted_pitch text default '',
  submitted_full_text text default '',
  submitted_conflict_disclosure text default '',
  submitted_topic text default '',
  submitted_consent boolean default false,
  submitted_ip_hash text default null,
  submitted_user_agent text default ''
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id bigint;
  reference text;
begin
  if not submitted_consent then
    raise exception 'Consent is required before submitting a reader opinion'
      using errcode = '22023';
  end if;
  if length(trim(coalesce(submitted_name, ''))) < 2
     or length(trim(coalesce(submitted_email, ''))) < 5
     or length(trim(coalesce(submitted_headline, ''))) < 8
     or length(trim(coalesce(submitted_pitch, ''))) < 20
     or length(trim(coalesce(submitted_full_text, ''))) > 100000
     or length(trim(coalesce(submitted_topic, ''))) > 160
     or length(trim(coalesce(submitted_conflict_disclosure, ''))) > 5000
     or submitted_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Provide a valid reader opinion name, email, headline, topic, and pitch'
      using errcode = '22023';
  end if;

  if submitted_ip_hash is not null
     and exists (
       select 1
       from public.opinion_submissions submission
       where submission.ip_hash = submitted_ip_hash
         and submission.created_at > now() - interval '10 minutes'
     ) then
    raise exception 'A reader opinion was submitted recently. Wait ten minutes before submitting another.'
         using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.opinion_submissions submission
    where submission.email = lower(trim(submitted_email))
      and submission.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'An opinion from this email was submitted recently. Wait ten minutes before submitting another.'
      using errcode = '22023';
  end if;

  reference := 'OP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.opinion_submissions(
    display_name, email, phone, headline, pitch, full_text, conflict_disclosure,
    submission_reference, topic, consent_at, ip_hash, user_agent
  ) values (
    trim(submitted_name), lower(trim(submitted_email)), trim(coalesce(submitted_phone, '')),
    trim(submitted_headline), trim(submitted_pitch), trim(coalesce(submitted_full_text, '')),
    trim(coalesce(submitted_conflict_disclosure, '')), reference,
    trim(coalesce(submitted_topic, '')), now(), submitted_ip_hash,
    left(trim(coalesce(submitted_user_agent, '')), 500)
  ) returning id into saved_id;
  return reference;
end;
$$;

revoke all on function public.chowk_submit_reader_opinion_v2(
  text, text, text, text, text, text, text, text, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.chowk_submit_reader_opinion_v2(
  text, text, text, text, text, text, text, text, boolean, text, text
) to anon, authenticated;

create or replace function public.chowk_review_opinion_story(
  target_article bigint,
  decision text,
  action_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  article_row public.articles%rowtype;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if decision not in ('approve', 'request_changes', 'reject') then
    raise exception 'Choose approve, request_changes, or reject'
      using errcode = '22023';
  end if;
  if decision <> 'approve' and length(trim(coalesce(action_note, ''))) < 2 then
    raise exception 'Add a review note for this opinion decision'
      using errcode = '22023';
  end if;
  if not (
    public.chowk_org_user_has_capability('newsroom.opinion.review')
    or public.chowk_org_user_has_capability('newsroom.opinion.publish')
    or public.chowk_org_user_has_capability('newsroom.editorial.publish')
  ) then
    raise exception 'Opinion review permission required'
      using errcode = '42501';
  end if;

  select * into article_row
  from public.articles
  where id = target_article
  for update;
  if not found then
    raise exception 'Story not found' using errcode = 'P0002';
  end if;
  if article_row.content_type not in ('opinion', 'editorial') then
    raise exception 'The selected story is not an opinion or editorial'
      using errcode = '22023';
  end if;

  update public.articles
  set opinion_review_status = case decision
        when 'approve' then 'approved'
        when 'request_changes' then 'revisions_requested'
        when 'reject' then 'rejected'
      end,
      opinion_reviewer_id = actor,
      workflow_status = case decision
        when 'approve' then workflow_status
        when 'request_changes' then 'changes_requested'
        when 'reject' then 'rejected'
      end,
      status = case decision
        when 'reject' then 'archived'
        else status
      end,
      review_note = case
        when decision = 'approve' then ''
        else trim(action_note)
      end,
      published_at = case
        when decision in ('request_changes', 'reject') then null
        else published_at
      end,
      workflow_updated_at = now()
  where id = target_article;
end;
$$;

revoke all on function public.chowk_review_opinion_story(bigint, text, text) from public, anon;
grant execute on function public.chowk_review_opinion_story(bigint, text, text) to authenticated;

create or replace function public.chowk_convert_reader_opinion_submission(
  target_submission bigint,
  contributor_id bigint default null,
  article_category_id bigint default null,
  article_title text default null,
  article_slug text default null,
  article_excerpt text default '',
  article_content text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission public.opinion_submissions%rowtype;
  saved_id bigint;
  selected_title text;
  selected_content text;
  selected_slug text;
  selected_contributor bigint;
begin
  if not public.chowk_org_user_has_capability('newsroom.opinion.review') then
    raise exception 'Opinion review permission required'
      using errcode = '42501';
  end if;
  select * into submission
  from public.opinion_submissions
  where id = target_submission
  for update;
  if not found then
    raise exception 'Reader opinion submission not found'
      using errcode = 'P0002';
  end if;
  if submission.status = 'converted'
     or submission.created_article_id is not null then
    raise exception 'This reader opinion has already been converted'
      using errcode = '22023';
  end if;

  selected_title := trim(coalesce(article_title, submission.headline));
  selected_content := trim(coalesce(article_content, submission.full_text, submission.pitch));
  if length(selected_title) < 8 or length(selected_content) < 50 then
    raise exception 'Add a complete headline and story text before converting this submission'
      using errcode = '22023';
  end if;
  selected_slug := trim(coalesce(article_slug, ''));
  if selected_slug = '' then
    selected_slug := 'reader-opinion-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  end if;
  if selected_slug = '' then
    raise exception 'A valid story slug could not be created'
      using errcode = '22023';
  end if;

  selected_contributor := contributor_id;
  if selected_contributor is null then
    insert into public.newsroom_contributors(
      display_name, slug, contributor_type, public_bio, institutional_affiliation,
      contact_email, is_active, created_by
    ) values (
      submission.display_name,
      'reader-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      'reader', '', '', submission.email, true, auth.uid()
    )
    on conflict (slug) do update set updated_at = now()
    returning id into selected_contributor;
  end if;

  saved_id := public.chowk_workspace_create_opinion_story(
    selected_title, selected_slug, coalesce(article_excerpt, left(selected_content, 240)),
    selected_content, article_category_id, null, null, null, null,
    'opinion', 'routine', submission.pitch, '', null, '',
    submission.conflict_disclosure, '', null, '',
    selected_contributor, '', submission.conflict_disclosure,
    '', ''
  );

  update public.opinion_submissions
  set status = 'converted',
      created_article_id = saved_id,
      reviewer_id = auth.uid(),
      review_note = 'Converted to an opinion story for editorial review.'
  where id = target_submission;
  return saved_id;
end;
$$;

revoke all on function public.chowk_convert_reader_opinion_submission(
  bigint, bigint, bigint, text, text, text, text
) from public, anon;
grant execute on function public.chowk_convert_reader_opinion_submission(
  bigint, bigint, bigint, text, text, text, text
) to authenticated;

create or replace function public.chowk_capture_article_revision_opinion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.opinion_contributor_id is null
     or new.opinion_column_name is null
     or new.conflict_of_interest_disclosure is null
     or new.fact_sources is null
     or new.ai_use_disclosure is null
     or new.opinion_review_status is null
     or new.opinion_reviewer_id is null then
    select article.opinion_contributor_id, article.opinion_column_name,
           article.conflict_of_interest_disclosure, article.fact_sources,
           article.ai_use_disclosure, article.opinion_review_status,
           article.opinion_reviewer_id
    into new.opinion_contributor_id, new.opinion_column_name,
         new.conflict_of_interest_disclosure, new.fact_sources,
         new.ai_use_disclosure, new.opinion_review_status,
         new.opinion_reviewer_id
    from public.articles article
    where article.id = new.article_id;
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_article_revision_capture_opinion on public.article_revisions;
create trigger chowk_article_revision_capture_opinion
before insert on public.article_revisions
for each row execute function public.chowk_capture_article_revision_opinion();

create or replace function public.chowk_guard_opinion_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.content_type in ('opinion', 'editorial')
     and (
       new.workflow_status in ('published', 'scheduled')
       or new.status = 'published'
     )
     and new.opinion_review_status is distinct from 'approved' then
    raise exception 'Opinions and editorials must be approved before publication'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_guard_opinion_publication on public.articles;
create trigger chowk_guard_opinion_publication
before insert or update of status, workflow_status, published_at, opinion_review_status, content_type
on public.articles
for each row execute function public.chowk_guard_opinion_publication();

commit;
