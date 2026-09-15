# autoparts

VIN-based auto parts marketplace — Web + iOS + Android. Initial market: Georgia.

Full specification lives in [`docs/`](docs/). Start with
[`docs/00-index-and-decisions.md`](docs/00-index-and-decisions.md) (map, build
sequence, architecture decisions) and
[`docs/05-fitment-engine.md`](docs/05-fitment-engine.md) (the core of the product).

## Requirements

- Node.js 20+
- pnpm 12+
- PostgreSQL 16 (see below — Docker is optional)

## Getting started

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm db:migrate
pnpm db:seed
pnpm dev
```

| Service | URL |
|---------|-----|
| Web (build status) | http://localhost:3000 |
| API | http://localhost:3001 |
| Swagger UI | http://localhost:3001/docs |
| Readiness | http://localhost:3001/ready |
| Catalogue counters | http://localhost:3001/api/v1/meta/catalog |

## Database

Two supported setups. The schema and migrations are identical either way; only
`DATABASE_URL` differs.

### A. Portable PostgreSQL (no admin rights, no reboot) — current dev default

Used on machines where Docker Desktop cannot be installed (it needs
administrator rights and WSL2 — see ADR-009). Binaries live in
`%LOCALAPPDATA%\autoparts-pg`, the server listens on **port 5433**.

> **The cluster must not use `--locale=C`.** Under it, non-ASCII characters are
> not letters, and Georgian text search and `pg_trgm` stop working with no error
> at all — see ADR-011. Initialise with a UTF-8 ctype:
>
> ```powershell
> initdb -D <data> -U autoparts --encoding=UTF8 --locale="English_United States.utf8"
> ```

```powershell
$pg = "$env:LOCALAPPDATA\autoparts-pg\pgsql\bin"
& "$pg\pg_ctl.exe" -D "$env:LOCALAPPDATA\autoparts-pg\data" -l "$env:LOCALAPPDATA\autoparts-pg\server.log" start
& "$pg\pg_ctl.exe" -D "$env:LOCALAPPDATA\autoparts-pg\data" stop    # to stop
```

```
DATABASE_URL=postgresql://autoparts:autoparts@127.0.0.1:5433/autoparts
```

### B. Docker

```bash
docker compose -f infra/docker-compose.yml up -d
```

```
DATABASE_URL=postgresql://autoparts:autoparts@127.0.0.1:5432/autoparts
```

Redis and OpenSearch are only needed from build steps 9 and 7 respectively.
Until then they are reported as `not_configured` and nothing depends on them.

### Migrations

```bash
pnpm db:migrate         # apply pending migrations
pnpm db:migrate:status   # what is applied, what is pending
pnpm db:seed             # idempotent development data
pnpm db:reset            # drop the schema (local databases only)
```

Applied migrations are immutable: the runner stores a checksum and refuses to
continue if a file that has already run was edited. Add a new migration
instead.

## Layout

```
apps/api        NestJS backend
apps/web        Next.js customer web
packages/core   shared domain types, enums, Money, identifier + VIN helpers, RBAC
packages/db     migration runner, seed data
db/migrations   plain SQL migrations
infra/          docker-compose for local datastores
docs/           the specification
```

`apps/partner`, `apps/admin`, `apps/mobile`, `packages/fitment`,
`packages/providers` and `packages/i18n` are created at the build step that
first needs them — see the build sequence in `docs/00`.

## Build progress

Step 2 of 12 — Data Layer. The status page at http://localhost:3000 shows the
current step, dependency readiness, seeded row counts and a live price
comparison across partners.
