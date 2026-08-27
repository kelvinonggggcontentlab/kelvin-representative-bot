create table if not exists public.kr_conversations (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null unique,
  telegram_user_id bigint,
  telegram_username text,
  display_name text,
  relationship_state text not null default 'UNKNOWN' check (relationship_state in ('CURRENT', 'HISTORICAL', 'UNKNOWN', 'CONFLICT')),
  current_mode text not null default 'CASUAL' check (current_mode in ('CASUAL', 'PLAYFUL', 'CARING', 'SERIOUS', 'CONFLICT', 'OPERATIONAL', 'HIGH_RISK')),
  archive_context jsonb not null default '{}'::jsonb,
  live_verified_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kr_webhook_events (
  id uuid primary key default gen_random_uuid(),
  telegram_update_id bigint not null unique,
  verified boolean not null,
  payload jsonb not null,
  processing_status text not null default 'RECEIVED' check (processing_status in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.kr_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.kr_conversations(id) on delete cascade,
  telegram_update_id bigint unique,
  telegram_message_id bigint,
  direction text not null check (direction in ('INBOUND', 'OUTBOUND')),
  message_kind text not null default 'TEXT',
  body text,
  raw_payload jsonb not null default '{}'::jsonb,
  in_reply_to_telegram_message_id bigint,
  delivery_status text not null default 'RECEIVED' check (delivery_status in ('RECEIVED', 'DRAFTED', 'HELD', 'APPROVED', 'SENT', 'REJECTED', 'FAILED')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (conversation_id, telegram_message_id, direction)
);

create table if not exists public.kr_approval_items (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.kr_conversations(id) on delete cascade,
  inbound_message_id uuid not null unique references public.kr_messages(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'SEND_FAILED')),
  risk_level text not null check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN')),
  risk_categories text[] not null default '{}'::text[],
  hold_reason text not null,
  draft_text text not null,
  edited_text text,
  reviewer_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  outbound_message_id uuid references public.kr_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kr_memories (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.kr_conversations(id) on delete cascade,
  memory_layer text not null check (memory_layer in ('FACT', 'RELATIONSHIP', 'EPISODIC', 'PREFERENCE', 'STATE')),
  subject text not null,
  statement text not null,
  structured_value jsonb not null default '{}'::jsonb,
  source_type text not null check (source_type in ('ARCHIVE', 'LIVE_TELEGRAM', 'OWNER_OVERRIDE', 'SYSTEM')),
  source_reference text,
  observed_at timestamptz,
  recorded_at timestamptz not null default now(),
  confidence smallint not null check (confidence between 0 and 100),
  verification_status text not null check (verification_status in ('OBSERVED', 'INFERRED', 'UNCERTAIN', 'CONFLICT', 'HISTORICAL', 'CURRENT', 'UNKNOWN')),
  is_live_verified boolean not null default false,
  is_active boolean not null default true,
  expires_at timestamptz,
  created_by text not null default 'SYSTEM',
  check (not (source_type = 'ARCHIVE' and is_live_verified = true))
);

create table if not exists public.kr_overrides (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.kr_conversations(id) on delete cascade,
  scope text not null check (scope in ('GLOBAL', 'CONVERSATION')),
  instruction text not null,
  source_type text not null default 'OWNER_OVERRIDE' check (source_type = 'OWNER_OVERRIDE'),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  is_active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  check ((scope = 'GLOBAL' and conversation_id is null) or (scope = 'CONVERSATION' and conversation_id is not null))
);

create table if not exists public.kr_bot_settings (
  id boolean primary key default true check (id),
  auto_send_low_risk boolean not null default false,
  bot_enabled boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now()
);

insert into public.kr_bot_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.kr_owner_notifications (
  id uuid primary key default gen_random_uuid(),
  approval_item_id uuid not null references public.kr_approval_items(id) on delete cascade,
  channel text not null check (channel in ('TELEGRAM_OWNER')),
  status text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  external_message_id bigint,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists kr_messages_conversation_created_at_idx on public.kr_messages (conversation_id, created_at desc);
create index if not exists kr_messages_update_id_idx on public.kr_messages (telegram_update_id) where telegram_update_id is not null;
create index if not exists kr_approvals_status_created_at_idx on public.kr_approval_items (status, created_at desc);
create index if not exists kr_memories_lookup_idx on public.kr_memories (conversation_id, memory_layer, verification_status, is_active, recorded_at desc);
create index if not exists kr_overrides_active_idx on public.kr_overrides (is_active, effective_from, effective_until);

alter table public.kr_conversations enable row level security;
alter table public.kr_webhook_events enable row level security;
alter table public.kr_messages enable row level security;
alter table public.kr_approval_items enable row level security;
alter table public.kr_memories enable row level security;
alter table public.kr_overrides enable row level security;
alter table public.kr_bot_settings enable row level security;
alter table public.kr_owner_notifications enable row level security;
