create extension if not exists pgcrypto;

create table if not exists elders (
  id uuid primary key default gen_random_uuid(),
  external_identity_hash text not null unique,
  preferred_language text not null default 'hi-IN',
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists memory_items (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid not null references elders(id) on delete cascade,
  kind text not null check (kind in ('profile', 'episode', 'thread')),
  status text not null check (status in ('pending', 'approved', 'discarded')),
  content_ciphertext bytea not null,
  source_turn_hash text not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  user_confirmed boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memory_items_prompt_lookup
  on memory_items (elder_id, status, kind, expires_at, updated_at desc);

create table if not exists reminder_drafts (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid not null references elders(id) on delete cascade,
  message_ciphertext bytea not null,
  schedule_json jsonb not null,
  timezone text not null default 'Asia/Kolkata',
  state text not null check (state in ('draft', 'confirmed', 'cancelled')) default 'draft',
  read_back_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists reminder_events (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references reminder_drafts(id) on delete cascade,
  event text not null check (event in ('due', 'snoozed', 'taken', 'skipped', 'cancelled')),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists safety_audit_events (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid references elders(id) on delete set null,
  category text not null,
  action text not null,
  confidence numeric(4, 3),
  content_hash text,
  created_at timestamptz not null default now()
);

comment on column memory_items.content_ciphertext is
  'Application-encrypted memory text. Never store plaintext transcripts here.';
comment on column reminder_drafts.message_ciphertext is
  'Application-encrypted reminder wording. The LLM cannot activate a draft.';

-- search_path is pinned to empty so this function cannot be tricked into
-- resolving an unqualified name (e.g. a same-named function or type) from a
-- schema an attacker made writable earlier in the caller's search_path.
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists memory_items_set_updated_at on memory_items;
create trigger memory_items_set_updated_at
  before update on memory_items
  for each row
  execute function set_updated_at();

-- Row-level security is enabled with no policies attached. Until a policy is
-- added, only a role with BYPASSRLS (the Postgres/Supabase service role) can
-- read or write these tables; anon/authenticated access is configured later
-- once elder identity and consent scoping are defined.
alter table elders enable row level security;
alter table memory_items enable row level security;
alter table reminder_drafts enable row level security;
alter table reminder_events enable row level security;
alter table safety_audit_events enable row level security;
