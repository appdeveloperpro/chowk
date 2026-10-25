alter table public.categories
  add column if not exists icon_key text not null default 'newspaper';

alter table public.categories
  drop constraint if exists categories_icon_key_check;

alter table public.categories
  add constraint categories_icon_key_check
  check (icon_key in (
    'newspaper',
    'siren',
    'sprout',
    'trophy',
    'cpu',
    'leaf',
    'chart',
    'clapperboard',
    'landmark',
    'globe',
    'book',
    'heart',
    'map-pin',
    'cloud',
    'briefcase'
  ));
