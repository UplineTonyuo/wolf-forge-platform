# Architecture

## Locked decisions

- No permanent sidebar
- Desktop uses global top navigation
- Modules use contextual horizontal navigation
- Backend foundation before heavy UI work
- First vertical slice: Client -> Order -> Task -> Activity
- Billing comes after core fulfillment
- Wayfront/SPP is a workflow reference, not our visual design

## Initial domain model

- User
- Role
- Company
- Client
- Service
- Order
- Order Task
- Activity Event

## Phase 1 application contracts

### Completion transitions

Moving an order or order task out of `complete` must clear `completed_at` in the same database operation. Historical completion transitions belong in `activity_events`; `completed_at` represents current completion state, not immutable history.

### Activity attribution

Authenticated database writes normalize the activity actor to `auth.uid()` and the timestamp to `now()`. `service_role` is a trusted backend path.

For user-initiated backend activity written through `service_role`, `actor_profile_id` must come from the server-verified authenticated session. Never trust a client-supplied actor or audit timestamp.

For system events, `actor_profile_id` may be `NULL`, and the backend may deliberately assign the event timestamp when required.

### Contact and profile behavior

For Phase 1, one portal profile belongs to one company. Moving a portal profile between companies is an explicit administrative operation, and historical contact/profile linkage may need to be severed before relocation. This is intentional until multi-company membership is designed.

Archived portal profiles may remain linked to a client contact as a historical contact of record.
