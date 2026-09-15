# autoparts

VIN-based auto parts marketplace — Web + iOS + Android. Initial market: Georgia.

Enter a VIN once, and only parts confirmed to fit that exact car are ever shown.

The specification lives in [`docs/`](docs/). Start with
[`docs/00-index-and-decisions.md`](docs/00-index-and-decisions.md) (map, build
sequence, architecture decisions) and
[`docs/05-fitment-engine.md`](docs/05-fitment-engine.md) (the core of the
product).

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
| Web | http://localhost:3000 |
| Partner portal | http://localhost:3000/partner |
| Admin panel | http://localhost:3000/admin |
| Build status | http://localhost:3000/status |
| API | http://localhost:3001 |
| Swagger UI | http://localhost:3001/docs |
| Readiness | http://localhost:3001/ready |

### Development accounts

Seeded by `pnpm db:seed`, password `dev-password-change-me`. The seed refuses to
run when `NODE_ENV=production`.

| Account | Role |
|---------|------|
| `customer@autoparts.dev` | Customer |
| `partner@autoparts.dev` | Partner admin — Auto Motors |
| `partner2@autoparts.dev` | Partner admin — Parts Center |
| `admin@autoparts.dev` | Platform admin |
| `super@autoparts.dev` | Super admin |

### Sample VINs

The mock provider decodes these. US-market VINs dominate on purpose: that is
what Georgia imports (ADR-003).

| VIN | Vehicle |
|-----|---------|
| `WBA1J5C50FV123456` | BMW 228i 2016 — asks a clarifying question |
| `2HKRW2H875H112233` | Honda CR-V 2020 |
| `W0L0AHL0885667788` | Opel Astra 2008 — EU market |

## Database

Two supported setups. The schema and migrations are identical either way; only
`DATABASE_URL` differs.

### A. Portable PostgreSQL (no admin rights, no reboot) — current dev default

Used on machines where Docker Desktop cannot be installed (it needs
administrator rights and WSL2 — ADR-009). Binaries live in
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
& "$pg\pg_ctl.exe" -D "$env:LOCALAPPDATA\autoparts-pg\data" -l "$env:LOCALAPPDATA\autoparts-pg\srv.log" start
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

Redis and OpenSearch are in the compose file but nothing requires them: search
runs on PostgreSQL (ADR-010) and locking uses advisory locks (ADR-012).

### Migrations

```bash
pnpm db:migrate          # apply pending migrations
pnpm db:migrate:status   # what is applied, what is pending
pnpm db:seed             # idempotent development data
pnpm db:reset            # drop the schema (local databases only)
```

Applied migrations are immutable: the runner stores a checksum and refuses to
continue if a file that already ran was edited. Add a new migration instead.

## Tests

```bash
pnpm test:unit    # 47 unit assertions, no database or network
pnpm test:e2e     # 200 end-to-end assertions against a running API
pnpm test         # both
```

The end-to-end runner pauses between suites: auth is rate limited per IP, and
six suites back to back legitimately trip it.

| Suite | Covers |
|-------|--------|
| `e2e-vin-garage` | auth, VIN decoding, garage, isolation |
| `e2e-catalog-fitment` | catalogue, locales, the R1 rule |
| `e2e-partner` | partner scoping, CSV import, offers |
| `e2e-search` | Georgian/English, synonyms, typos, OEM lookup |
| `e2e-purchase` | offers, cart, reservation, payment, pickup, refund |
| `e2e-admin` | conflicts, partners, markup, analytics, audit |

## Layout

```
apps/api        NestJS backend
apps/web        Next.js — customer, plus /partner and /admin (ADR-013)
apps/mobile     React Native (Expo) — typechecked, not yet run on a device
packages/core   domain types, enums, Money, identifier + VIN helpers, RBAC
packages/fitment   the Fitment Engine — pure logic, no database
packages/providers VIN, payment and partner-integration adapters
packages/api-client typed client shared by every app
packages/i18n   translation keys (ka, en)
packages/db     migration runner, seed, VIN cipher
db/migrations   plain SQL migrations
tests/          end-to-end suites
infra/          docker-compose for local datastores
docs/           the specification
```

## Build progress

All twelve steps of the build sequence in `docs/00` are complete. What remains
before launch is not code — see the open questions in `docs/00`: an acquiring
contract, signed partners, and a commercial VIN provider for EU-market cars.

The mobile app is typechecked and shares the same API client, but has not been
run on a simulator or device from this environment.
