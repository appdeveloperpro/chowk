alter table public.article_types
  add column if not exists minimum_word_count integer
    check (minimum_word_count between 1 and 100000);

create or replace function public.chowk_validate_article_minimum_word_count()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  required_word_count integer;
  submitted_word_count integer;
begin
  if new.workflow_status not in (
    'submitted', 'moderator_review', 'editor_review', 'scheduled', 'published'
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.content is not distinct from old.content
     and new.content_type is not distinct from old.content_type
     and new.workflow_status is not distinct from old.workflow_status then
    return new;
  end if;

  select minimum_word_count
  into required_word_count
  from public.article_types
  where key = new.content_type;

  if required_word_count is null then
    raise exception 'A minimum word count has not been configured for the selected content type. Contact an administrator.'
      using errcode = '22023';
  end if;

  select count(*)
  into submitted_word_count
  from regexp_split_to_table(
    btrim(coalesce(new.content, '')),
    '[[:space:]]+'
  ) as words(word)
  where word <> '';

  if submitted_word_count < required_word_count then
    raise exception 'This content type requires at least % words; this story currently has %.',
      required_word_count, submitted_word_count
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists chowk_articles_validate_minimum_word_count on public.articles;
create trigger chowk_articles_validate_minimum_word_count
before insert or update on public.articles
for each row execute function public.chowk_validate_article_minimum_word_count();

revoke all on function public.chowk_validate_article_minimum_word_count() from public, anon, authenticated;
