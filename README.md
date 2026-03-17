# FinTrack

A personal net worth tracker and FIRE (Financial Independence, Retire Early) planning tool, built for UK investors. Track investment funds across savings, pensions, and property with periodic value snapshots, then project your path to early retirement.

Includes a **Claude Code skill** (`/fire-advisor`) that acts as an interactive FIRE financial advisor — it reads your live portfolio data and helps you model scenarios, optimise tax wrappers, stress-test your bridge strategy, and plan your route to early retirement.

## Features

- Track funds across savings, pensions, and property with monthly snapshots
- Net worth dashboard with historical charts
- FIRE projection engine with configurable withdrawal rates, growth assumptions, and tax modelling
- UK-specific: ISAs, SIPPs, LISAs, GIAs, state pension, pension access ages
- Bridge stress testing (can your accessible savings survive until pension age?)
- Income and expense tracking
- CSV import for bulk historical data
- Cognito authentication (single-user)

## Architecture

Three independent packages (no monorepo tooling):

- **`backend/`** — AWS Lambda function handlers (TypeScript, esbuild). Handlers for funds, snapshots, FIRE config, income/expenses, and CSV import. DynamoDB single-table design.
- **`frontend/`** — React 19 SPA with Vite, Tailwind CSS v4, Recharts. Auth via AWS Amplify/Cognito.
- **`infrastructure/`** — AWS CDK (TypeScript). DynamoDB, Cognito, API Gateway HTTP API, Lambda, S3 + CloudFront with custom domain.

## Prerequisites

- Node.js 20+
- AWS CLI configured with a profile
- AWS account with Route53 hosted zone for your domain
- [Claude Code](https://claude.ai/code) (for the FIRE advisor skill)

## Setup

### 1. Configure your AWS environment

Edit `infrastructure/bin/infrastructure.ts` and set your AWS account ID, domain, and hosted zone — or set them as environment variables:

```bash
export CDK_DEFAULT_ACCOUNT=123456789012
export FINTRACK_DOMAIN=fintrack.yourdomain.com
export FINTRACK_HOSTED_ZONE_ID=Z0123456789ABC
export FINTRACK_ZONE_NAME=yourdomain.com
export AWS_PROFILE=your-profile
```

### 2. Deploy everything

```bash
./deploy.sh
```

This will:
1. Build the backend Lambda functions
2. Deploy the CDK infrastructure (DynamoDB, Cognito, API Gateway, Lambda, S3, CloudFront)
3. Build the frontend with the correct API endpoint and Cognito config
4. Upload the frontend to S3 and invalidate CloudFront
5. Create a Cognito user (on first deploy)

### 3. Import your data (optional)

See [CSV Import](#csv-import) below.

## Commands

### Backend
```bash
cd backend && npm ci && npm run build
```

### Frontend
```bash
cd frontend && npm ci
npm run dev       # local dev server
npm run build     # production build
npm run lint      # eslint
npm test          # vitest
```

### Infrastructure
```bash
cd infrastructure && npm ci
npm run build     # tsc
npm run synth     # CDK synth
npm run diff      # CDK diff
npm run deploy    # CDK deploy
```

## The FIRE Advisor Skill

The standout feature of this project is the Claude Code skill at `.claude/skills/fire-advisor/`. When you run Claude Code in this repo, you can invoke `/fire-advisor` to start an interactive session with an AI financial advisor that:

- Fetches your live portfolio data from the API
- Summarises your net worth, asset allocation, and FIRE progress
- Models scenarios: "What if I increase ISA contributions by 500/month?", "What if markets return 5% instead of 7%?"
- Analyses tax wrapper strategy (ISA vs SIPP priority, LISA considerations, drawdown order)
- Stress-tests your bridge period (the gap between early retirement and pension access age)
- Remembers context between sessions

The advisor is UK-focused and understands ISAs, SIPPs, LISAs, GIAs, UK tax bands, state pension, and pension access ages.

To use it, open Claude Code in this repo and type `/fire-advisor`.

## CSV Import

The CSV import script (`scripts/csv-import.ts`) is designed to bulk-load historical fund data from a spreadsheet export. **It is built around a specific CSV format and will need to be modified for your own data.**

### Expected CSV format

- **Row 1**: Headers — first column is a label, remaining columns are dates in `Mon-YY` format (e.g. `Nov-18`, `Dec-18`) or `M/D/YY` format (e.g. `4/1/26`)
- **Rows 2-5**: Metadata rows (skipped by the importer)
- **Rows 6-18**: Fund data — one row per fund, values in GBP with `£` prefix (e.g. `£38,311.65`, `-£1,120.72`, `£-` for zero)
- **Rows 19+**: Summary rows (skipped)

### Fund definitions

The script has a hardcoded `FUND_DEFINITIONS` array that maps specific CSV row indices to fund records with names, categories, subcategories, and tax wrappers. The included definitions are examples — you'll need to edit this array to match your own funds.

### Adapting for your data

The simplest approach is to ask Claude to help you:

1. Show Claude your CSV file (or describe its structure)
2. Ask Claude to modify `scripts/csv-import.ts` to match your format
3. The key things to change are:
   - `FUND_DEFINITIONS` — your fund names, categories, and row indices
   - Row indices if your metadata rows differ
   - Date format parsing if yours is different
   - Value parsing if your currency format differs

Alternatively, you can skip the CSV import entirely and enter data manually through the web UI.

### Running the import

```bash
export AWS_PROFILE=your-profile
export CSV_PATH=../path-to-your-data.csv
cd scripts && npm ci && npm run import
```

It's safe to wipe all data and re-import at any time:

```bash
cd scripts && bash clear-table.sh   # deletes all items from DynamoDB
npm run import                       # re-import from CSV
```

## DynamoDB Schema

Single-table design. Table name: `FinTrack`. Partition key: `pk`, sort key: `sk`. GSI1: `gsi1pk`/`gsi1sk`.

| Entity | pk | sk | GSI1 |
|--------|----|----|------|
| Fund | `FUND` | `FUND#<id>` | — |
| Snapshot | `FUND#<id>` | `SNAP#<date>` | `SNAPSHOTS` / `<date>#FUND#<id>` |

Snapshots denormalize fund name and category at write time. Values are stored in **pence** (integer).

## Environment Variables

Set via `.env.production` (auto-generated by `deploy.sh` from CDK outputs):

- `VITE_API_URL` — API Gateway endpoint
- `VITE_USER_POOL_ID` — Cognito User Pool ID
- `VITE_USER_POOL_CLIENT_ID` — Cognito client ID

For the FIRE advisor skill, create a `.env` file in the project root:

```
FINTRACK_PASSWORD=your-cognito-password
```

## License

MIT
