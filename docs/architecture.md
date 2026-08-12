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
