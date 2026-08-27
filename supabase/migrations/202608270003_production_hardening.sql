alter table public.kr_webhook_events
  add column if not exists correlation_id text,
  add column if not exists attempt_count integer not null default 0;

alter table public.kr_approval_items
  add column if not exists claimed_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists finalized_at timestamptz;

alter table public.kr_approval_items
  drop constraint if exists kr_approval_items_status_check;

alter table public.kr_approval_items
  add constraint kr_approval_items_status_check
  check (status in ('PENDING', 'SENDING', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'SEND_FAILED'));

create table if not exists public.kr_approval_events (
  id uuid primary key default gen_random_uuid(),
  approval_item_id uuid not null references public.kr_approval_items(id) on delete cascade,
  event_type text not null check (event_type in ('CREATED', 'CLAIMED', 'APPROVED', 'REJECTED', 'SENT', 'SEND_FAILED', 'EXPIRED')),
  actor_type text not null check (actor_type in ('SYSTEM', 'OWNER')),
  actor_id text,
  detail jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now()
);

create index if not exists kr_approval_events_item_created_at_idx on public.kr_approval_events (approval_item_id, created_at desc);
create index if not exists kr_approval_items_conversation_id_idx on public.kr_approval_items (conversation_id);
create index if not exists kr_approval_items_outbound_message_id_idx on public.kr_approval_items (outbound_message_id) where outbound_message_id is not null;
create index if not exists kr_approval_items_pending_expiry_idx on public.kr_approval_items (status, expires_at) where status = 'PENDING';
create index if not exists kr_overrides_conversation_id_idx on public.kr_overrides (conversation_id) where conversation_id is not null;
create index if not exists kr_owner_notifications_approval_item_id_idx on public.kr_owner_notifications (approval_item_id);
create index if not exists kr_webhook_events_correlation_id_idx on public.kr_webhook_events (correlation_id) where correlation_id is not null;

alter table public.kr_approval_events enable row level security;
create policy kr_approval_events_service_role_only on public.kr_approval_events for all to service_role using (true) with check (true);
