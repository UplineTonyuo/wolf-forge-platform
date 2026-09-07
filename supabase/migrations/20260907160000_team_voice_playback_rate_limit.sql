-- Wolf Forge Platform
-- KI-057 (DB-only half): Team Voice playback signed-URL minting had no
-- rate limit. app_get_team_voice_playback is called on every playback
-- attempt and its caller (TeamVoiceService.playback(), PR #19, not yet
-- merged) mints a 5-minute signed Storage URL for whatever this RPC
-- returns, with no bound anywhere in that chain. This mirrors the ceiling
-- already chosen for the symmetric operation, upload-prepare
-- (app_prepare_team_voice_upload, 12/min), which is the RPC's own sibling
-- in 20260901151505_team_voice_messages_and_pins.sql.
--
-- This migration does not edit that already-applied migration. It
-- redeclares the same function via create-or-replace, the established
-- pattern for tightening an existing RPC without rewriting history (see
-- 20260902163628_fix_idor_authorization_boundaries.sql doing the same for
-- app_archive_contact / app_adjust_company_balance / app_archive_order).
--
-- Every other property is preserved byte-for-byte: signature, security
-- definer, search_path, the existing membership authorization
-- (private.require_team_conversation_member, unchanged, still raises
-- 42501 for a non-member), the returned jsonb shape, and the revoke/grant
-- boundary (authenticated only). The one deliberate change beyond adding
-- the throttle line is STABLE -> VOLATILE: private.consume_rate_limit
-- writes to private.rate_limit_counters, and this codebase's own
-- convention is that "a function that records counters must be VOLATILE"
-- (see the C2-3 assertion in 042_c23_abuse_rate_limits.test.sql) —
-- marking a function STABLE while it performs a write misrepresents its
-- side effects to the planner, and the sibling app_prepare_team_voice_upload
-- is VOLATILE for the identical reason.

create or replace function public.app_get_team_voice_playback(p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  message public.team_messages%rowtype;
  actor_id uuid;
begin
  select * into message from public.team_messages where id = p_message_id;
  if message is null or message.message_type <> 'voice' then
    raise exception 'voice message not found' using errcode = 'P0002';
  end if;
  actor_id := private.require_team_conversation_member(message.conversation_id);
  perform private.consume_rate_limit(
    'team.voice.playback.actor.minute', actor_id::text, interval '1 minute', 12
  );
  return jsonb_build_object(
    'message_id', message.id, 'conversation_id', message.conversation_id,
    'storage_path', message.voice_storage_path, 'mime_type', message.voice_mime_type,
    'duration_ms', message.voice_duration_ms, 'expired_at', message.voice_expired_at
  );
end;
$$;
revoke all on function public.app_get_team_voice_playback(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_get_team_voice_playback(uuid) to authenticated;
