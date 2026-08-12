# Wolf Forge Platform

Internal operations platform for Wolf Forge.

## Core principles

- Backend-first architecture
- No permanent sidebar
- Top navigation with contextual navigation
- Real operational data only
- Staff and client permissions separated
- Full activity and audit history

## Backend development

Copy `.env.example` to a local ignored environment file when an application process needs explicit credentials. Never expose `SUPABASE_SECRET_KEY` to browser code.

Useful commands:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:db
npm.cmd run lint:db
npm.cmd run smoke:backend
```

The backend smoke workflow is local-development-only. It refuses non-local Supabase URLs and creates synthetic, archival-safe records in the disposable local database.
