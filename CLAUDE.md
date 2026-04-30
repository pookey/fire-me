# CLAUDE.md

FinTrack: personal net worth tracker with FIRE projections.

Three independent npm packages — **no monorepo tooling**, each with its own `package.json` and `node_modules`:

- `backend/` — Lambda handlers, TypeScript bundled with esbuild
- `frontend/` — React 19 + Vite + Tailwind v4, Cognito auth via Amplify
- `infrastructure/` — AWS CDK (two stacks, eu-west-2 primary + us-east-1 cert)

## Things that aren't obvious from the code

- **DynamoDB single-table** (`FinTrack`, pk/sk + GSI1):
  - Funds: `pk=FUND`, `sk=FUND#<id>`
  - Snapshots: `pk=FUND#<id>`, `sk=SNAP#<date>`; GSI1 `gsi1pk=SNAPSHOTS`, `gsi1sk=<date>#FUND#<id>`
  - Snapshots **denormalize** fund name and category at write time
- All monetary values are stored as **integer pence**
- Lambda route dispatch is `event.routeKey` string-matching inside each handler (not separate functions per route)

## Deploy

`./deploy.sh` does the full pipeline (backend build → CDK deploy → frontend build with CDK outputs → S3 sync → CloudFront invalidate). **Always run `cd frontend && npm test` and confirm it passes before deploying.**

After the first deploy, `deploy.sh` writes `API_BASE_URL` and `COGNITO_CLIENT_ID` back into `.env`.

## More detail

- `docs/architecture.md` — handlers, stacks, frontend pages, regions
- `docs/commands.md` — build / dev / test / deploy commands and env vars
- `README.md` — user-facing setup, FIRE advisor skill
