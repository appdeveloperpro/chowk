alter table public.reporter_application_private_details
  drop constraint if exists reporter_application_preferred_locations_check;

alter table public.reporter_application_private_details
  add constraint reporter_application_preferred_locations_check
  check (length(trim(coverage_localities)) between 2 and 1000)
  not valid;
