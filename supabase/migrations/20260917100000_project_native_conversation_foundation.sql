-- Project/Order conversation independence, Phase 1: additive database
-- foundation only. Project messages currently reuse the canonical Ticket
-- message model (tickets.order_id, app_send_order_message; see migration
-- 20260913184254 and the note at the top of 20260915100009). This migration
-- creates the Project-native equivalents in parallel, without touching that
-- existing path: no Ticket table, RPC, or write path changes; no historical
-- data copied; no UI cutover. A Project's conversation is keyed directly to
-- its Order (public.orders.id) — no separate project_conversations table,
-- matching the same "one Order owns its own thread" shape tickets.order_id
-- already uses.

-- -----------------------------------------------------------------------------
-- project_messages
-- -----------------------------------------------------------------------------

create table public.project_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  author_profile_id uuid references public.profiles (id) on delete restrict,
  author_type text not null,
  body text not null,
  request_id uuid,
  reply_to_message_id uuid,
  reply_quote_text text,
  reply_to_attachment_id uuid,
  created_at timestamptz not null default now(),
  -- No 'guest' author: unlike Tickets (which can originate from an
  -- anonymous Contact Form submission), a Project always has an Order and
  -- therefore a known company/client. No message_kind/visibility columns
  -- either: Phase 1 carries no internal-note behavior for Projects (locked
  -- product decision, revisit only with explicit approval), so there is
  -- exactly one kind of row and nothing to branch on yet.
  constraint project_messages_author_type_valid check (author_type in ('internal', 'client', 'system')),
  constraint project_messages_body_length_valid check (char_length(body) <= 50000),
  constraint project_messages_author_consistent check (
    (author_type in ('internal', 'client') and author_profile_id is not null)
    or (author_type = 'system' and author_profile_id is null)
  ),
  constraint project_messages_request_identity_unique unique (order_id, request_id),
  constraint project_messages_reply_shape_valid check (
    (reply_to_message_id is null and reply_quote_text is null)
    or (reply_to_message_id is not null and nullif(btrim(reply_quote_text), '') is not null
      and char_length(reply_quote_text) <= 500)
  ),
  constraint project_messages_reply_attachment_requires_message check (
    reply_to_attachment_id is null or reply_to_message_id is not null
  )
);

-- Composite anchor so replies and attachments can be verified against the
-- exact parent row by a real foreign key, never a cross-Project id.
alter table public.project_messages
  add constraint project_messages_id_order_unique unique (id, order_id);

alter table public.project_messages
  add constraint project_messages_reply_source_fkey
    foreign key (reply_to_message_id, order_id)
    references public.project_messages (id, order_id) on delete restrict;

create index project_messages_order_created_idx
on public.project_messages (order_id, created_at, id);
create index project_messages_author_idx
on public.project_messages (author_profile_id, created_at desc)
where author_profile_id is not null;
create index project_messages_reply_source_idx
on public.project_messages (reply_to_message_id)
where reply_to_message_id is not null;

-- -----------------------------------------------------------------------------
-- project_attachments
-- -----------------------------------------------------------------------------

create table public.project_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  project_message_id uuid not null references public.project_messages (id) on delete restrict,
  storage_object_key text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  checksum_sha256 text not null,
  scan_status text not null default 'pending',
  uploaded_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint project_attachments_message_order_fkey
    foreign key (project_message_id, order_id)
    references public.project_messages (id, order_id) on delete restrict,
  constraint project_attachments_names_not_blank check (
    btrim(storage_object_key) <> '' and btrim(original_name) <> '' and btrim(mime_type) <> ''
  ),
  constraint project_attachments_size_positive check (size_bytes > 0),
  constraint project_attachments_checksum_valid check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  constraint project_attachments_scan_status_valid check (scan_status in ('pending', 'clean', 'rejected'))
);

-- Composite anchor for the attachment-level reply target below: an
-- attachment can only ever be targeted by a reply to its own parent message.
alter table public.project_attachments
  add constraint project_attachments_id_message_unique unique (id, project_message_id);

create index project_attachments_order_idx on public.project_attachments (order_id, created_at);
create index project_attachments_message_idx on public.project_attachments (project_message_id);
create index project_attachments_uploader_idx on public.project_attachments (uploaded_by_profile_id)
where uploaded_by_profile_id is not null;

-- Now that project_attachments exists, close the loop on project_messages:
-- a reply's optional attachment target must belong to its exact parent
-- message (the multi-image case), never a sibling or cross-Project row.
alter table public.project_messages
  add constraint project_messages_reply_attachment_fkey
    foreign key (reply_to_attachment_id, reply_to_message_id)
    references public.project_attachments (id, project_message_id) on delete restrict;

-- -----------------------------------------------------------------------------
-- project_message_reactions
-- -----------------------------------------------------------------------------

create table public.project_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.project_messages (id) on delete cascade,
  reactor_profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Same nine-code vocabulary as ticket_message_reactions.reaction_code
  -- (D-190). Postgres has no shared domain to reference without altering
  -- that existing column/table, which is out of scope here, so the code
  -- list is intentionally duplicated verbatim rather than introduced twice
  -- with different values.
  reaction_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_message_reactions_code_valid check (reaction_code in (
    'like', 'heart', 'laugh', 'wow', 'celebrate', 'fire', 'eyes', 'pray', 'check'
  )),
  constraint project_message_reactions_unique
    unique (message_id, reactor_profile_id, reaction_code)
);

create trigger project_message_reactions_set_updated_at
before update on public.project_message_reactions
for each row execute function private.set_updated_at();

create index project_message_reactions_message_active_idx
on public.project_message_reactions (message_id)
where active;

-- -----------------------------------------------------------------------------
-- Immutability, comparable to Ticket messages
-- -----------------------------------------------------------------------------

create function private.prevent_project_message_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Project messages are append-only' using errcode = '55000';
end;
$$;

create trigger project_messages_prevent_mutation
before update or delete on public.project_messages
for each row execute function private.prevent_project_message_mutation();
create trigger project_messages_prevent_truncate
before truncate on public.project_messages
for each statement execute function private.prevent_project_message_mutation();

revoke all on function private.prevent_project_message_mutation()
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS and least privilege
--
-- No read/write RPC suite exists yet for these tables (Phase 1 is database
-- foundation only), so there is deliberately no SELECT/INSERT policy for
-- `authenticated` either — direct access is fully denied for every
-- browser-reachable role until a Phase 2 pass adds the safe read models and
-- SECURITY DEFINER mutation RPCs, mirroring how Ticket data was authorized.
-- -----------------------------------------------------------------------------

alter table public.project_messages enable row level security;
alter table public.project_attachments enable row level security;
alter table public.project_message_reactions enable row level security;
alter table public.project_message_reactions force row level security;

revoke all on table public.project_messages, public.project_attachments
from public, anon, authenticated, service_role;
grant select, insert on table public.project_messages, public.project_attachments to service_role;

-- Reactions stay fully locked, including from service_role, matching
-- ticket_message_reactions: this table is only ever meant to be touched from
-- inside a SECURITY DEFINER function owned by the table owner (a future
-- Phase 2 RPC), never by a direct grant to any role.
revoke all on table public.project_message_reactions
from public, anon, authenticated, service_role;

comment on table public.project_messages is
  'Project-native, append-only Order conversation (Phase 1 foundation). Not yet read or written by any RPC or UI surface; the existing Ticket-backed Order conversation (tickets.order_id / app_send_order_message) remains the live path.';
comment on table public.project_attachments is
  'Project-native attachment metadata only, mirroring ticket_attachments. Binary uploads are not wired to this table yet; no storage bucket was created in Phase 1 since nothing writes to one.';
comment on table public.project_message_reactions is
  'Project-native message reactions, mirroring ticket_message_reactions (D-190) including its nine-code vocabulary. Locked down for direct access; usable only once a Phase 2 RPC is added.';
