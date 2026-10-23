alter table public.audit_logs
  add column if not exists actor_name text,
  add column if not exists actor_email text,
  add column if not exists actor_ip text,
  add column if not exists request_id text,
  add column if not exists user_agent text,
  add column if not exists outcome text not null default 'success',
  add column if not exists reason text,
  add column if not exists changed_fields jsonb not null default '[]'::jsonb;

update public.audit_logs logs
set actor_name = profiles.full_name,
    actor_email = profiles.email
from public.profiles
where logs.actor_id = profiles.id
  and (logs.actor_name is null or logs.actor_email is null);

update public.audit_logs logs
set changed_fields = (
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'field', field_name,
      'before', logs.before_data -> field_name,
      'after', logs.after_data -> field_name
    ) order by field_name),
    '[]'::jsonb
  )
  from (
    select key as field_name from jsonb_object_keys(coalesce(logs.before_data, '{}'::jsonb)) as key
    union
    select key as field_name from jsonb_object_keys(coalesce(logs.after_data, '{}'::jsonb)) as key
  ) fields
  where logs.before_data -> field_name is distinct from logs.after_data -> field_name
     or (coalesce(logs.before_data, '{}'::jsonb) ? field_name)
        is distinct from (coalesce(logs.after_data, '{}'::jsonb) ? field_name)
)
where logs.changed_fields = '[]'::jsonb
  and (logs.before_data is not null or logs.after_data is not null);

create or replace function public.chowk_audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  row_id text;
  current_actor uuid;
  current_actor_name text;
  current_actor_email text;
  changes jsonb;
  request_headers jsonb := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb,
    '{}'::jsonb
  );
begin
  if tg_op <> 'INSERT' then old_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_row := to_jsonb(new); end if;
  row_id := coalesce(new_row ->> 'id', old_row ->> 'id');
  current_actor := (select auth.uid());

  if current_actor is not null then
    select full_name, email
    into current_actor_name, current_actor_email
    from public.profiles
    where id = current_actor;
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'field', field_name,
      'before', old_row -> field_name,
      'after', new_row -> field_name
    ) order by field_name),
    '[]'::jsonb
  )
  into changes
  from (
    select key as field_name from jsonb_object_keys(coalesce(old_row, '{}'::jsonb)) as key
    union
    select key as field_name from jsonb_object_keys(coalesce(new_row, '{}'::jsonb)) as key
  ) fields
  where old_row -> field_name is distinct from new_row -> field_name
     or (coalesce(old_row, '{}'::jsonb) ? field_name)
        is distinct from (coalesce(new_row, '{}'::jsonb) ? field_name);

  insert into public.audit_logs (
    actor_id, actor_name, actor_email, actor_ip, request_id, user_agent,
    action, table_name, record_id, before_data, after_data, changed_fields,
    outcome, reason
  )
  values (
    current_actor, current_actor_name, current_actor_email,
    nullif(request_headers ->> 'x-chowk-client-ip', ''),
    nullif(request_headers ->> 'x-chowk-request-id', ''),
    nullif(request_headers ->> 'x-chowk-user-agent', ''),
    tg_op, tg_table_name, row_id, old_row, new_row, changes,
    'success',
    nullif(trim(coalesce(new_row ->> 'review_note', old_row ->> 'review_note',
      new_row ->> 'reason', old_row ->> 'reason', '')), '')
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.chowk_record_admin_event(
  event_action text,
  target_table text,
  target_record_id text,
  event_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor uuid := (select auth.uid());
  current_actor_name text;
  current_actor_email text;
  request_headers jsonb := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb,
    '{}'::jsonb
  );
begin
  if current_actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if event_action not in ('USER_CREATED', 'PASSWORD_CHANGED') or target_table <> 'profiles' then
    raise exception 'Unsupported admin audit event' using errcode = '22023';
  end if;
  select full_name, email
  into current_actor_name, current_actor_email
  from public.profiles
  where id = current_actor;

  insert into public.audit_logs (
    actor_id, actor_name, actor_email, actor_ip, request_id, user_agent,
    action, table_name, record_id, after_data, changed_fields, outcome
  )
  values (
    current_actor, current_actor_name, current_actor_email,
    nullif(request_headers ->> 'x-chowk-client-ip', ''),
    nullif(request_headers ->> 'x-chowk-request-id', ''),
    nullif(request_headers ->> 'x-chowk-user-agent', ''),
    event_action, target_table, target_record_id,
    coalesce(event_data, '{}'::jsonb),
    case
      when jsonb_typeof(event_data -> 'changed_fields') = 'array'
        then event_data -> 'changed_fields'
      else '[]'::jsonb
    end,
    'success'
  );
end;
$$;

drop trigger if exists chowk_profiles_audit on public.profiles;
create trigger chowk_profiles_audit after insert or update or delete on public.profiles
for each row execute function public.chowk_audit_row();
drop trigger if exists chowk_articles_audit on public.articles;
create trigger chowk_articles_audit after insert or update or delete on public.articles
for each row execute function public.chowk_audit_row();
drop trigger if exists chowk_categories_audit on public.categories;
create trigger chowk_categories_audit after insert or update or delete on public.categories
for each row execute function public.chowk_audit_row();
drop trigger if exists chowk_locations_audit on public.locations;
create trigger chowk_locations_audit after insert or update or delete on public.locations
for each row execute function public.chowk_audit_row();
drop trigger if exists chowk_reporter_types_audit on public.reporter_types;
create trigger chowk_reporter_types_audit after insert or update or delete on public.reporter_types
for each row execute function public.chowk_audit_row();
drop trigger if exists chowk_reporter_applications_audit on public.reporter_applications;
create trigger chowk_reporter_applications_audit after insert or update or delete on public.reporter_applications
for each row execute function public.chowk_audit_row();
drop trigger if exists chowk_live_streams_audit on public.live_streams;
create trigger chowk_live_streams_audit after insert or update or delete on public.live_streams
for each row execute function public.chowk_audit_row();
drop trigger if exists chowk_article_reports_audit on public.article_reports;
create trigger chowk_article_reports_audit after insert or update or delete on public.article_reports
for each row execute function public.chowk_audit_row();
drop trigger if exists chowk_comments_audit on public.comments;
create trigger chowk_comments_audit after insert or update or delete on public.comments
for each row execute function public.chowk_audit_row();
drop trigger if exists chowk_media_catalog_audit on public.media_catalog;
create trigger chowk_media_catalog_audit after insert or update or delete on public.media_catalog
for each row execute function public.chowk_audit_row();

revoke all on public.audit_logs from public, anon, authenticated;
grant select on public.audit_logs to authenticated;
revoke all on sequence public.audit_logs_id_seq from public, anon, authenticated;
revoke all on function public.chowk_audit_row() from public, anon, authenticated;
revoke all on function public.chowk_record_admin_event(text, text, text, jsonb) from public, anon;
grant execute on function public.chowk_record_admin_event(text, text, text, jsonb) to authenticated;
