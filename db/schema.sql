-- Shore schema. Idempotent: safe to run repeatedly (npx tsx scripts/migrate.ts).

-- Every fetched source document, verbatim. Provenance offsets index into `text`,
-- and `content_hash` lets ingestion skip re-extracting unchanged documents.
create table if not exists documents (
  id           text primary key,          -- NWS product id
  source_id    text not null,             -- 'nws-srf' | 'nws-cap' | 'nws-sps'
  url          text not null,
  text         text not null,
  content_hash text not null,
  issued_at    timestamptz,
  retrieved_at timestamptz not null default now()
);
create index if not exists documents_hash_idx on documents(content_hash);

-- One row per extracted value. A field can have several rows when a zone is split into sub-areas.
create table if not exists observations (
  id           bigserial primary key,
  document_id  text not null references documents(id) on delete cascade,
  zone_id      text not null,
  period       text not null,             -- 'today' | 'tomorrow'
  period_label text not null,             -- source wording: 'REST OF TODAY'
  field        text not null,
  value        text,                      -- null is a legitimate answer
  numeric_min  double precision,
  numeric_max  double precision,
  numeric_unit text,
  approximate  boolean,
  sub_area     text,
  source_id    text not null,
  source_url   text not null,
  raw_span     text,
  char_start   int,
  char_end     int,
  issued_at    timestamptz,
  retrieved_at timestamptz not null default now(),
  extractor    text not null,             -- 'regex' | 'nemotron' | 'reconciled'
  confidence   text not null              -- 'high' | 'medium' | 'low'
);
create index if not exists obs_zone_idx on observations(zone_id, period);
-- Which Nemotron model read the value (null for parser-only values). Added after launch; additive.
alter table observations add column if not exists model text;
-- Why a parser/model disagreement was resolved the way it was, when Nemotron adjudicated it.
alter table observations add column if not exists adjudication_reason text;
create index if not exists obs_doc_idx on observations(document_id);

-- Per-zone segment facts that aren't field values: name, beaches, official headlines.
create table if not exists zone_segments (
  document_id  text not null references documents(id) on delete cascade,
  zone_id      text not null,
  zone_name    text,
  beaches      text[] not null default '{}',
  headlines    text[] not null default '{}',
  primary key (document_id, zone_id)
);

-- Active NWS alerts (CAP). Headline is stored verbatim and never paraphrased.
create table if not exists alerts (
  id           text primary key,
  event        text not null,
  severity     text,
  headline     text,
  description  text,
  onset        timestamptz,
  expires      timestamptz,
  source_url   text not null,
  zones        text[] not null,
  retrieved_at timestamptz not null default now()
);
create index if not exists alerts_zones_idx on alerts using gin(zones);
