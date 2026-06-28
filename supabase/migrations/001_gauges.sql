create table if not exists gauges (
  key            text primary key,
  name           text not null,
  location       text not null,
  source         text not null check (source in ('usgs', 'wsc', 'cdec')),
  site           text not null,
  sensor         integer,
  dur            text,
  text_key       text not null,
  gauge_url      text not null,
  low            numeric,
  high           numeric,
  discharge      numeric,
  discharge_unit text not null default 'cfs',
  stage          numeric,
  stage_unit     text not null default 'ft',
  reading_time   timestamptz,
  updated_at     timestamptz
);

alter table gauges enable row level security;

create policy "public read"
  on gauges for select
  using (true);
