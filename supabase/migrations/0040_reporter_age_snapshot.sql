alter table public.reporter_application_private_details
  add column if not exists age_at_application smallint;

alter table public.reporter_application_private_details
  drop constraint if exists reporter_application_age_at_application_check;
alter table public.reporter_application_private_details
  add constraint reporter_application_age_at_application_check
  check (age_at_application is null or age_at_application between 0 and 130);

create or replace function public.chowk_set_reporter_application_age()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  application_date date;
begin
  if new.date_of_birth is null then
    new.age_at_application := null;
  elsif tg_op = 'INSERT' then
    select (application.created_at at time zone 'Asia/Kolkata')::date into application_date
    from public.reporter_applications application
    where application.id = new.application_id;
    if application_date is null then
      raise exception 'Reporter application date is required to calculate age'
        using errcode = '23514';
    end if;
    new.age_at_application := extract(year from age(application_date, new.date_of_birth))::smallint;
  elsif new.date_of_birth is distinct from old.date_of_birth then
    select (application.created_at at time zone 'Asia/Kolkata')::date into application_date
    from public.reporter_applications application
    where application.id = new.application_id;
    if application_date is null then
      raise exception 'Reporter application date is required to calculate age'
        using errcode = '23514';
    end if;
    new.age_at_application := extract(year from age(application_date, new.date_of_birth))::smallint;
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_set_reporter_application_age
  on public.reporter_application_private_details;
create trigger chowk_set_reporter_application_age
  before insert or update on public.reporter_application_private_details
  for each row execute function public.chowk_set_reporter_application_age();

update public.reporter_application_private_details details
set age_at_application = extract(year from age(
  (application.created_at at time zone 'Asia/Kolkata')::date,
  details.date_of_birth
))::smallint
from public.reporter_applications application
where application.id = details.application_id
  and details.date_of_birth is not null;
