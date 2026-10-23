alter table public.rto_offices
  drop constraint if exists rto_offices_rto_code_check;
alter table public.rto_offices
  add constraint rto_offices_rto_code_check
  check (rto_code ~ '^[A-Za-z0-9]{2,8}$');

alter table public.reporter_types
  add column if not exists updated_at timestamptz not null default now();

insert into public.states(state_code,state_name,is_active)
values
  ('AP','Andhra Pradesh',true),
  ('AR','Arunachal Pradesh',true),
  ('AS','Assam',true),
  ('BR','Bihar',true),
  ('CG','Chhattisgarh',true),
  ('GA','Goa',true),
  ('GJ','Gujarat',true),
  ('HR','Haryana',true),
  ('HP','Himachal Pradesh',true),
  ('JH','Jharkhand',true),
  ('KA','Karnataka',true),
  ('KL','Kerala',true),
  ('MP','Madhya Pradesh',true),
  ('MH','Maharashtra',true),
  ('MN','Manipur',true),
  ('ML','Meghalaya',true),
  ('MZ','Mizoram',true),
  ('NL','Nagaland',true),
  ('OD','Odisha',true),
  ('PB','Punjab',true),
  ('RJ','Rajasthan',true),
  ('SK','Sikkim',true),
  ('TN','Tamil Nadu',true),
  ('TS','Telangana',true),
  ('TR','Tripura',true),
  ('UP','Uttar Pradesh',true),
  ('UK','Uttarakhand',true),
  ('WB','West Bengal',true),
  ('AN','Andaman and Nicobar Islands',true),
  ('CH','Chandigarh',true),
  ('DD','Dadra and Nagar Haveli and Daman and Diu',true),
  ('DL','Delhi',true),
  ('JK','Jammu and Kashmir',true),
  ('LA','Ladakh',true),
  ('LD','Lakshadweep',true),
  ('PY','Puducherry',true)
on conflict do nothing;

insert into public.reporter_types(name,type_code,description,is_active)
select 'Tehsil Reporter','01','Reporter assigned to a tehsil / RTO reporting area.',true
where not exists (
  select 1 from public.reporter_types where name='Tehsil Reporter' or type_code='01'
)
on conflict do nothing;

insert into public.rto_offices(state_id,rto_code,city_name,is_active)
select s.id, seed.rto_code, seed.city_name, true
from public.states s
cross join (values
  ('11','Saharanpur'),
  ('12','Muzaffarnagar'),
  ('13','Bulandshahar'),
  ('14','Ghaziabad'),
  ('15','Meerut'),
  ('16','Gautam Buddha Nagar'),
  ('17','Baghpat'),
  ('19','Shamli'),
  ('20','Bijnor'),
  ('21','Moradabad'),
  ('22','Rampur'),
  ('23','Amroha (JP Nagar)'),
  ('24','Badaun'),
  ('25','Bareilly'),
  ('26','Pilibhit'),
  ('27','Shahjahanpur'),
  ('30','Hardoi'),
  ('31','Lakhimpur Kheri'),
  ('32','Lucknow'),
  ('32A','Trans Gomti Office Lucknow'),
  ('33','Raebareli'),
  ('34','Sitapur'),
  ('35','Unnao'),
  ('36','Amethi'),
  ('37','Hapur'),
  ('38','Sambhal'),
  ('40','Bahraich'),
  ('41','Barabanki'),
  ('42','Ayodhya'),
  ('43','Gonda'),
  ('44','Sultanpur'),
  ('45','Ambedkar Nagar'),
  ('46','Shravasti'),
  ('47','Balrampur'),
  ('50','Azamgarh'),
  ('51','Basti'),
  ('52','Deoria'),
  ('53','Gorakhpur'),
  ('54','Mau'),
  ('55','Siddharthnagar'),
  ('56','Maharajganj'),
  ('57','Kushinagar'),
  ('58','Sant Kabir Nagar'),
  ('60','Ballia'),
  ('61','Ghazipur'),
  ('62','Jaunpur'),
  ('63','Mirzapur'),
  ('64','Sonbhadra'),
  ('65','Varanasi'),
  ('65A','Varanasi'),
  ('66','Bhadohi'),
  ('67','Chandauli'),
  ('70','Prayagraj'),
  ('71','Fatehpur'),
  ('72','Pratapgarh'),
  ('73','Kaushambi'),
  ('74','Kannauj'),
  ('75','Etawah'),
  ('76','Farrukhabad'),
  ('77','Kanpur Dehat'),
  ('78','Kanpur Nagar'),
  ('79','Auraiya'),
  ('80','Agra'),
  ('81','Aligarh'),
  ('82','Etah'),
  ('83','Firozabad'),
  ('84','Mainpuri'),
  ('85','Mathura'),
  ('86','Hathras'),
  ('87','Kasganj'),
  ('90','Banda'),
  ('91','Hamirpur'),
  ('92','Jalaun'),
  ('93','Jhansi'),
  ('94','Lalitpur'),
  ('95','Mahoba'),
  ('96','Chitrakoot Dham')
) as seed(rto_code,city_name)
where s.state_code='UP'
on conflict (state_id,rto_code) do nothing;

create or replace function public.chowk_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration jsonb := new.raw_user_meta_data -> 'reporter_application';
  target_state bigint;
  target_rto bigint;
  target_type bigint;
  accepted_version text;
  accepted_sha256 text;
  signer_name text;
  acceptance_statement text;
  agreement public.reporter_agreement_versions%rowtype;
  application_id bigint;
begin
  insert into public.profiles (id,email,full_name,phone,role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name',''),
    nullif(new.raw_user_meta_data ->> 'phone',''),
    'subscriber'
  )
  on conflict (id) do update set email=excluded.email;

  if new.raw_user_meta_data ->> 'account_type' = 'reporter' then
    if jsonb_typeof(registration) is distinct from 'object'
       or new.raw_user_meta_data ->> 'accepted_policies' is distinct from 'true'
       or registration ->> 'accepted_reporter_agreement' is distinct from 'true'
       or coalesce(registration ->> 'state_id','') !~ '^[1-9][0-9]{0,18}$'
       or coalesce(registration ->> 'rto_office_id','') !~ '^[1-9][0-9]{0,18}$'
       or coalesce(registration ->> 'reporter_type_id','') !~ '^[1-9][0-9]{0,18}$' then
      raise exception 'Reporter application details and agreement acceptance are required' using errcode='22023';
    end if;

    target_state := (registration ->> 'state_id')::bigint;
    target_rto := (registration ->> 'rto_office_id')::bigint;
    target_type := (registration ->> 'reporter_type_id')::bigint;
    accepted_version := registration ->> 'agreement_version';
    accepted_sha256 := registration ->> 'agreement_sha256';
    signer_name := trim(coalesce(registration ->> 'signer_name',''));
    acceptance_statement := trim(coalesce(registration ->> 'acceptance_statement',''));

    select * into agreement
    from public.reporter_agreement_versions
    where status='published'
    for share;
    if not found
       or accepted_version is distinct from agreement.version
       or accepted_sha256 is distinct from agreement.sha256 then
      raise exception 'Review and accept the current published reporter agreement' using errcode='23514';
    end if;
    if length(signer_name)<2
       or acceptance_statement is distinct from 'I have read and accept the Chowk reporter agreement.' then
      raise exception 'Reporter agreement signer name and acceptance are required' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.states
      where id=target_state and is_active
    ) then
      raise exception 'Choose an active state' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.rto_offices
      where id=target_rto and state_id=target_state and is_active
    ) then
      raise exception 'Choose an active RTO in the selected state' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.reporter_types
      where id=target_type and is_active
    ) then
      raise exception 'Choose an active reporter type' using errcode='22023';
    end if;

    insert into public.reporter_applications (
      user_id,state_id,rto_office_id,reporter_type_id,agreement_accepted,
      agreement_version,agreement_sha256,agreement_document_url,
      agreement_signer_name,agreement_acceptance_statement,
      agreement_accepted_at,status
    )
    values (
      new.id,target_state,target_rto,target_type,true,
      agreement.version,agreement.sha256,agreement.document_url,
      signer_name,acceptance_statement,now(),'pending'
    )
    returning id into application_id;

    insert into public.reporter_agreement_acceptances (
      application_id,user_id,agreement_version,agreement_sha256,
      signer_name,acceptance_statement
    )
    values (
      application_id,new.id,agreement.version,agreement.sha256,
      signer_name,acceptance_statement
    );
  end if;
  return new;
end;
$$;
