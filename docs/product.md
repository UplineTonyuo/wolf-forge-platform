# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Wolf Forge internal staff use the platform to manage companies, client relationships, work, billing, communication, services, forms, and team access.
- Client-side users optionally use an authenticated portal to access only the capabilities granted to their Company relationship.

## Product Purpose

Wolf Forge Platform is the operating system for a digital marketing and SEO agency. It keeps internal operations and the client portal on one canonical data model while preserving strict authorization boundaries between them.

## Positioning

The platform treats a Company as the durable business entity, people as relationships to that Company, portal identity as optional, and Client as a lifecycle state rather than a duplicate business object.

## Operating Context

- Internal users work across Companies, Clients, Projects, Tickets, Invoices, Subscriptions, Services, Forms, Reporting, and Team workflows.
- Client users access Company-scoped work through the separate `/account` portal.
- Company records may exist before any person, portal profile, Auth identity, subscription, or billing activity exists.

## Capabilities and Constraints

- Company membership, portal access, Auth identity, and capability grants are distinct concepts and must not be collapsed into one flag.
- A Company may have multiple people. At most one active primary/owner relationship is allowed unless the product explicitly adopts co-owners later.
- All mutations require server-side capability checks and database enforcement. Browser state is never authorization.
- Cross-company data access must fail closed through scoped RPCs and RLS.
- `/clients` and `/companies` are related but distinct product surfaces. Existing Client, portal, billing, project, ticket, subscription, wallet, reporting, Team, and conversation flows must remain compatible.
- Company creation uses the existing `CompanyService` / `CompanyRepository` / `app_create_company` path and must not implicitly create people, credentials, portal users, subscriptions, or external side effects.
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

1. Preserve one canonical business entity instead of duplicating Company and Client records.
2. Keep human relationships independent from authentication and portal access.
3. Authorize every read and mutation at the server and database boundaries.
4. Reuse proven Wolf Forge architecture and interaction primitives before adding new concepts.
5. Show only behavior and data that the current model can truthfully support.

## Accessibility & Inclusion

Interactive surfaces must preserve keyboard operation, visible focus, Escape dismissal, focus return, reduced-motion support, readable contrast, adequate touch targets, and responsive layouts from 320px through desktop.
