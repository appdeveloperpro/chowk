begin;

create or replace function public.chowk_validate_reporter_application_details()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  application_date date;
begin
  if tg_op = 'INSERT' then
    if length(trim(coalesce(new.emergency_contact_name, ''))) not between 2 and 120 then
      raise exception 'Enter a valid emergency contact name'
        using errcode = '22023';
    end if;
    if length(trim(coalesce(new.emergency_contact_relationship, ''))) not between 2 and 80 then
      raise exception 'Enter your relationship to the emergency contact'
        using errcode = '22023';
    end if;
    if coalesce(new.emergency_contact_phone, '') !~ '^[0-9]{10}$' then
      raise exception 'Enter the emergency contact mobile number using exactly 10 digits'
        using errcode = '22023';
    end if;
    if new.experience_years is null or new.experience_years not between 0 and 80 then
      raise exception 'Enter relevant experience in years (0 to 80)'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if new.emergency_contact_name is distinct from old.emergency_contact_name
     and length(trim(coalesce(new.emergency_contact_name, ''))) not between 2 and 120 then
    raise exception 'Enter a valid emergency contact name'
      using errcode = '22023';
  end if;
  if new.emergency_contact_relationship is distinct from old.emergency_contact_relationship
     and length(trim(coalesce(new.emergency_contact_relationship, ''))) not between 2 and 80 then
    raise exception 'Enter your relationship to the emergency contact'
      using errcode = '22023';
  end if;
  if new.emergency_contact_phone is distinct from old.emergency_contact_phone
     and coalesce(new.emergency_contact_phone, '') !~ '^[0-9]{10}$' then
    raise exception 'Enter the emergency contact mobile number using exactly 10 digits'
      using errcode = '22023';
  end if;
  if new.experience_years is distinct from old.experience_years
     and (new.experience_years is null or new.experience_years not between 0 and 80) then
    raise exception 'Enter relevant experience in years (0 to 80)'
      using errcode = '22023';
  end if;
  if new.mobile_number is distinct from old.mobile_number
     and coalesce(new.mobile_number, '') !~ '^[0-9]{10}$' then
    raise exception 'Enter the primary mobile number using exactly 10 digits'
      using errcode = '22023';
  end if;
  if new.date_of_birth is distinct from old.date_of_birth then
    select (application.created_at at time zone 'Asia/Kolkata')::date
    into application_date
    from public.reporter_applications application
    where application.id = new.application_id;

    if application_date is null or new.date_of_birth is null
       or extract(year from age(application_date, new.date_of_birth)) < 18 then
      raise exception 'Reporter applicants must be at least 18 years old'
        using errcode = '22023';
    end if;
  end if;
  if new.father_first_name is distinct from old.father_first_name
     and length(trim(coalesce(new.father_first_name, ''))) not between 1 and 80 then
    raise exception 'Enter a valid father’s first name'
      using errcode = '22023';
  end if;
  if new.father_last_name is distinct from old.father_last_name
     and length(trim(coalesce(new.father_last_name, ''))) not between 1 and 80 then
    raise exception 'Enter a valid father’s last name'
      using errcode = '22023';
  end if;
  if new.permanent_address_line1 is distinct from old.permanent_address_line1
     or new.permanent_address_line2 is distinct from old.permanent_address_line2
     or new.permanent_address_city is distinct from old.permanent_address_city
     or new.permanent_address_district is distinct from old.permanent_address_district
     or new.permanent_address_state is distinct from old.permanent_address_state
     or new.permanent_address_postal_code is distinct from old.permanent_address_postal_code then
    if length(trim(coalesce(new.permanent_address_line1, ''))) not between 2 and 160
       or length(trim(coalesce(new.permanent_address_line2, ''))) not between 2 and 160
       or length(trim(coalesce(new.permanent_address_city, ''))) not between 2 and 100
       or length(trim(coalesce(new.permanent_address_district, ''))) not between 2 and 100
       or length(trim(coalesce(new.permanent_address_state, ''))) not between 2 and 100
       or coalesce(new.permanent_address_postal_code, '') !~ '^[0-9]{6}$' then
      raise exception 'Complete the permanent address and enter a valid 6-digit PIN code'
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists chowk_validate_reporter_application_details
  on public.reporter_application_private_details;
create trigger chowk_validate_reporter_application_details
before insert or update on public.reporter_application_private_details
for each row execute function public.chowk_validate_reporter_application_details();

revoke all on function public.chowk_validate_reporter_application_details()
  from public, anon, authenticated;

commit;
