import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("../supabase/migrations/20260901151505_team_voice_messages_and_pins.sql");

describe("Team voice and pin security boundaries", () => {
  it("keeps the bucket private and omits browser Storage policies", () => {
    expect(migration).toContain("'team-voice-messages'");
    expect(migration).toMatch(/'team-voice-messages',[\s\S]*?false,[\s\S]*?5242880/);
    expect(migration).not.toMatch(/create policy[\s\S]*team-voice-messages/i);
  });

  it("derives privileged identity and conversation access inside every mutation RPC", () => {
    expect(migration).toContain("private.require_team_conversation_admin_or_owner(p_conversation_id)");
    expect(migration).toContain("private.require_team_conversation_admin_or_owner(message.conversation_id)");
    expect(migration).toContain("private.require_team_conversation_admin_or_owner(pin.conversation_id)");
    expect(migration).toContain("upload.created_by_profile_id <> actor_id");
    expect(migration).not.toMatch(/p_sender_id|p_pinned_by_profile_id/i);
    expect(migration).not.toMatch(/function public\.app_[^(]+\([^)]*p_actor_id/is);
  });

  it("permits only text pins, prevents duplicate active pins, and retains history", () => {
    expect(migration).toContain("message.message_type <> 'text'");
    expect(migration).toMatch(/create unique index team_message_pins_one_active_idx[\s\S]*where unpinned_at is null/);
    expect(migration).toContain("set unpinned_by_profile_id = actor_id, unpinned_at = changed_at");
  });

  it("makes cleanup service-role-only, bounded, exact-path, and voice-only", () => {
    expect(migration).toContain("grant execute on function public.app_list_team_voice_cleanup_batch(integer) to service_role");
    expect(migration).toContain("message.message_type = 'voice'");
    expect(migration).toContain("voice_storage_path = p_expected_path");
    expect(migration).toContain("limit least(greatest(coalesce(p_limit, 100), 1), 250)");
  });

  it("never stores audio bytes in PostgreSQL and never adds a browser Supabase client", () => {
    expect(migration).not.toMatch(/bytea|base64|arraybuffer|blob/i);
    expect(read("components/team/team-http-client.ts")).not.toContain("createClient(");
    expect(read("lib/team-voice/server-service.ts")).toContain('import "server-only"');
  });
});
