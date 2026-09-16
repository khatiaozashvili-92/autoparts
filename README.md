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

### Signing in

There are no passwords. Signing in is a phone number and a six-digit code sent
by SMS (ADR-015) — a number with no account gets one the first time it verifies
a code, so there is no separate registration step.

There is no SMS gateway on a developer machine, so `SMS_PROVIDER=console` prints
the code to the API log and `OTP_ECHO_CODE=true` also returns it in the
response, where the login page shows it. **Both are refused in production**: the
API will not start with `NODE_ENV=production` and either one set.

### Development accounts

Seeded by `pnpm db:seed`. The seed refuses to run when `NODE_ENV=production`.
The numbers are in the 555 00 00 xx block, which is not issued to subscribers.

| Sign in with | Role |
|--------------|------|
| `555 00 00 01` | Customer |
| `555 00 00 02` | Partner admin — Auto Motors |
| `555 00 00 03` | Partner admin — Parts Center |
| `555 00 00 04` | Platform admin |
| `555 00 00 05` | Super admin |

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
pnpm test:unit    # 62 unit assertions, no database or network
pnpm test:e2e     # end-to-end assertions against a running API
pnpm test         # both
```

The end-to-end suites sign in the same way the apps do, which means they need
the API running with `SMS_PROVIDER=console` and `OTP_ECHO_CODE=true`. Against a
real gateway they cannot sign in — correctly, since neither can anyone holding
somebody else's phone.

The runner pauses between suites: a given number may only be sent one code a
minute, and the suites sign the same seeded accounts in more than once. The
limiter working is the point — the harness waits rather than the product
loosening. A full run twice within the hour also needs `OTP_MAX_PER_HOUR` raised
in your local `.env`; the shipped default of 5 is the product's.

| Suite | Covers |
|-------|--------|
| `e2e-vin-garage` | phone sign-in, code handling, VIN decoding, garage, isolation |
| `e2e-catalog-fitment` | catalogue, locales, the R1 rule |
| `e2e-partner` | partner scoping, CSV import, offers |
| `e2e-search` | Georgian/English, synonyms, typos, OEM lookup |
| `e2e-purchase` | offers, cart, reservation, payment, pickup, refund |
| `e2e-admin` | conflicts, partners, markup, analytics, audit |

## Demo deployment

A single Ubuntu droplet runs the whole thing: nginx in front, both Node
processes on loopback, PostgreSQL local. `infra/deploy/` holds everything it
takes.

```bash
scp infra/deploy/provision.sh root@<host>:/root/     # Node, PG 16, nginx, swap
ssh root@<host> bash /root/provision.sh
git archive --format=tar HEAD | gzip | ssh root@<host> 'tar -xz -C /srv/autoparts'
ssh root@<host> 'cd /srv/autoparts && pnpm install && pnpm build && pnpm db:migrate && pnpm db:seed'
ssh root@<host> 'cd /srv/autoparts && pm2 start infra/deploy/ecosystem.config.cjs'
certbot --nginx -d <host>                            # after nginx.conf.template is in place
```

Three things about it are deliberate and easy to get wrong:

**One origin.** nginx serves the web app at `/` and proxies `/api/` to the API,
so both live under one hostname. Separate origins would mean the browser never
sends the demo password to the API, and would bring CORS back for nothing.

**`NEXT_PUBLIC_API_URL` must be right at build time, not run time.** Next
inlines it into the browser bundle, so changing it needs a rebuild. Set it to
the public origin or the deployed page will send its requests to whatever is
listening on the visitor's own machine.

**`NODE_ENV=staging`, not `production`.** There is no SMS gateway behind the
demo, so it runs on the console stub with the code echoed back — and
`loadConfig` refuses both under `production`, on purpose. What keeps that from
being an open door is the nginx password in front of the whole site, plus a
firewall that leaves only 80, 443 and SSH reachable while both services stay
bound to loopback.

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
