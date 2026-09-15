# autoparts

VIN-based auto parts marketplace — Web + iOS + Android. Initial market: Georgia.

Full specification lives in [`docs/`](docs/). Start with
[`docs/00-index-and-decisions.md`](docs/00-index-and-decisions.md) (map, build
sequence, architecture decisions) and
[`docs/05-fitment-engine.md`](docs/05-fitment-engine.md) (the core of the product).

## Requirements

- Node.js 20+
- pnpm 12+
- Docker (from build step 2, for PostgreSQL / Redis / OpenSearch)

## Getting started

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm dev
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Swagger UI | http://localhost:3001/docs |
| Readiness | http://localhost:3001/ready |

## Layout

```
apps/api        NestJS backend
apps/web        Next.js customer web
packages/core   shared domain types, enums, Money, identifier + VIN helpers, RBAC
db/             migrations and seeds (from step 2)
infra/          docker-compose for local datastores
docs/           the specification
```

`apps/partner`, `apps/admin`, `apps/mobile`, `packages/fitment`,
`packages/providers` and `packages/i18n` are created at the build step that
first needs them — see the build sequence in `docs/00`.

## Build progress

Step 1 of 12 — Architecture. The running status page at
http://localhost:3000 shows the current step, dependency readiness and the
active configuration.

Datastores are intentionally unconfigured at this step: `/ready` reports them
as `not_configured` rather than failing, so the skeleton is inspectable before
step 2 introduces the schema.
