insert into public.categories (name, slug, icon_key)
select category.name, category.slug, category.icon_key
from (
  values
    ('अपराध', 'crime', 'siren'),
    ('कृषि', 'agriculture', 'sprout'),
    ('खेल', 'sports', 'trophy'),
    ('बिज़नेस', 'business', 'chart'),
    ('तकनीक', 'technology', 'cpu'),
    ('पर्यावरण', 'environment', 'leaf'),
    ('मनोरंजन', 'entertainment', 'clapperboard'),
    ('राजनीति', 'politics', 'landmark'),
    ('विदेश', 'world', 'globe'),
    ('शिक्षा', 'education', 'book'),
    ('स्वास्थ्य', 'health', 'heart')
) as category(name, slug, icon_key)
where not exists (
  select 1
  from public.categories existing
  where existing.slug = category.slug
     or existing.name = category.name
)
on conflict (slug) do nothing;
