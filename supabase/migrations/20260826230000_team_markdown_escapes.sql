-- Team Communication V2.2 — plain-text projection understands escaped markers.
--
-- The composer is now rich text over the same constrained Markdown subset, and
-- its serializer writes CommonMark: a literal asterisk or underscore in
-- ordinary prose is stored escaped, so `2*3 costs _less` is persisted as
-- `2\*3 costs \_less` and reaches the reader as the writer typed it instead of
-- being mistaken for emphasis.
--
-- private.team_message_plain_text feeds previews, transient peeks, offline
-- digests and task titles. It has to tell an escaped marker from a real one:
-- strip the marker first and a preview reads `2\3`; unescape first and it reads
-- `23`. So escapes are parked in private-use code points, the real markers are
-- removed, and the parked characters come back as themselves.
--
-- Forward-only after 20260826220000. No stored message is rewritten: a legacy
-- V2.1 body carries no escapes, and every step below is the identity on a
-- string that has none.

create or replace function private.team_message_plain_text(p_body text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text := coalesce(p_body, '');
  -- Private-use code points. Nothing a person can type occupies this range, so
  -- parking an escaped marker here cannot collide with the message itself.
  parked_backslash text := chr(57344);
  parked_star      text := chr(57345);
  parked_underscore text := chr(57346);
  parked_backtick  text := chr(57347);
  parked_tilde     text := chr(57348);
begin
  -- An escaped backslash first, so `\\*` is read as "a backslash, then
  -- emphasis" rather than as "an escaped asterisk".
  clean := replace(clean, E'\\\\', parked_backslash);
  clean := replace(clean, E'\\*', parked_star);
  clean := replace(clean, E'\\_', parked_underscore);
  clean := replace(clean, E'\\`', parked_backtick);
  clean := replace(clean, E'\\~', parked_tilde);

  clean := regexp_replace(clean, E'\\[([^]\\n]+)\\]\\([^)]*\\)', E'\\1', 'g');
  clean := regexp_replace(clean, E'(^|\\n)[[:space:]]*([*-]|[0-9]+\\.)[[:space:]]+', E'\\1', 'g');
  clean := translate(clean, '*_`#', '');

  clean := replace(clean, parked_backslash, E'\\');
  clean := replace(clean, parked_star, '*');
  clean := replace(clean, parked_underscore, '_');
  clean := replace(clean, parked_backtick, '`');
  clean := replace(clean, parked_tilde, '~');

  clean := regexp_replace(clean, '[[:space:]]+', ' ', 'g');
  return btrim(clean);
end;
$$;

revoke all on function private.team_message_plain_text(text)
  from public, anon, authenticated, service_role;
