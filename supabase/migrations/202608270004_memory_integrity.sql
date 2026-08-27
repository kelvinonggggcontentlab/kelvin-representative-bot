alter table public.kr_memories
  add constraint kr_memories_archive_historical_check
  check (source_type <> 'ARCHIVE' or (verification_status = 'HISTORICAL' and is_live_verified = false));

alter table public.kr_memories
  add constraint kr_memories_current_live_verified_check
  check (verification_status <> 'CURRENT' or is_live_verified = true);

alter table public.kr_memories
  add constraint kr_memories_live_source_check
  check (is_live_verified = false or (verification_status in ('CURRENT', 'OBSERVED') and source_type in ('LIVE_TELEGRAM', 'OWNER_OVERRIDE')));

alter table public.kr_memories
  add constraint kr_memories_observed_timestamp_check
  check (verification_status <> 'OBSERVED' or observed_at is not null);

alter table public.kr_memories
  add constraint kr_memories_expiry_after_recorded_check
  check (expires_at is null or expires_at >= recorded_at);
