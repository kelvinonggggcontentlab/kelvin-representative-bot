create policy kr_conversations_service_role_only on public.kr_conversations for all to service_role using (true) with check (true);
create policy kr_webhook_events_service_role_only on public.kr_webhook_events for all to service_role using (true) with check (true);
create policy kr_messages_service_role_only on public.kr_messages for all to service_role using (true) with check (true);
create policy kr_approval_items_service_role_only on public.kr_approval_items for all to service_role using (true) with check (true);
create policy kr_memories_service_role_only on public.kr_memories for all to service_role using (true) with check (true);
create policy kr_overrides_service_role_only on public.kr_overrides for all to service_role using (true) with check (true);
create policy kr_bot_settings_service_role_only on public.kr_bot_settings for all to service_role using (true) with check (true);
create policy kr_owner_notifications_service_role_only on public.kr_owner_notifications for all to service_role using (true) with check (true);
