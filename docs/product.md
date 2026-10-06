# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Wolf Forge internal staff use the platform to manage clients, companies/teams, work, billing, communication, services, forms, and team access.
- Client-side users optionally use an authenticated portal to access only the capabilities granted to their Client record.

## Product Purpose

Wolf Forge Platform is the operating system for a digital marketing and SEO agency. It keeps internal operations and the client portal on one canonical data model while preserving strict authorization boundaries between them.

## Positioning

A Person (contact) is the human identity. Client is the lifecycle/business relationship a Person can have, and its Business Name is plain information on that Client record. A Company / Team is a separate, explicit organization a Person may optionally belong to. Client lifecycle and Company membership are independent; a Business Name never becomes a Company. Portal identity is optional.

## Operating Context

- Internal users work across Clients, Companies, Projects, Tickets, Invoices, Subscriptions, Services, Forms, Reporting, and Team workflows.
- Client users access their Client-scoped work through the separate `/account` portal.
- Client records live in `companies` (name = Business Name). Company / Team entities live in `organizations`; membership is an explicit `organization_members` row.
- A Company may exist with zero people.

## Capabilities and Constraints

- Client lifecycle, Company membership, portal access, Auth identity, and capability grants are distinct concepts and must not be collapsed into one flag.
- A Company may have multiple people. Membership is always explicit; it is never inferred from a matching name.
- Creating a Client never creates a Company; creating a Company never creates a Client.
- All mutations require server-side capability checks and database enforcement. Browser state is never authorization.
- Cross-company data access must fail closed through scoped RPCs and RLS.
- `/clients` and `/companies` are related but distinct product surfaces. Existing Client, portal, billing, project, ticket, subscription, wallet, reporting, Team, and conversation flows must remain compatible.
- Company creation uses `OrganizationService` / `OrganizationRepository` / `app_create_organization` and must not implicitly create people, Client records, credentials, portal users, subscriptions, or external side effects.
- Production data, hosted migrations, deployment, invitations, email, and external user creation require separate explicit authorization.

## Brand Commitments

- Product name: Wolf Forge Platform.
- Established visual language: navy `#000D51`, white and light canvas surfaces, restrained premium gold accents, and Inter for interface text.
- Company and Client experiences must be visibly and verbally distinguishable without copying competitor visuals.

## Evidence on Hand

- The repository contains the canonical schema, migrations, RLS policies, SECURITY DEFINER RPCs, authorization services, and existing client/company interfaces.
- Verified Wayfront research informs Company information architecture only. Its implementation, schema, and missing selector/POST response details are not evidence for Wolf Forge behavior.
- No testimonials, benchmark claims, or fabricated people/assets are authorized.

## Product Principles

1. Keep Client records and Company / Team entities separate; never infer one from the other.
2. Keep human relationships independent from authentication and portal access.
3. Authorize every read and mutation at the server and database boundaries.
4. Reuse proven Wolf Forge architecture and interaction primitives before adding new concepts.
5. Show only behavior and data that the current model can truthfully support.

## Accessibility & Inclusion

Interactive surfaces must preserve keyboard operation, visible focus, Escape dismissal, focus return, reduced-motion support, readable contrast, adequate touch targets, and responsive layouts from 320px through desktop.
