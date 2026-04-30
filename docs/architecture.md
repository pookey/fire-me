# Architecture

## Backend (`backend/src/`)

Five Lambda handlers under `handlers/`: `funds`, `snapshots`, `fireConfig`, `incomeExpenses`, `import`. Each handler dispatches internally on `event.routeKey`.

Shared utilities under `utils/`:
- `db.ts` — DynamoDB document client
- `response.ts` — API Gateway response helpers

Built with esbuild to `dist/handlers/`.

## Frontend (`frontend/`)

React 19 SPA with Vite, Tailwind CSS v4, Recharts. AWS Amplify / Cognito for auth.

Pages: Dashboard, DataEntry, Charts, Fire, Funds, Import.

## Infrastructure (`infrastructure/`)

AWS CDK in TypeScript. Two stacks with cross-region references:

- `FintrackCertStack` — ACM certificate in `us-east-1` (required for CloudFront)
- `FintrackStack` — `eu-west-2`: DynamoDB, Cognito User Pool, API Gateway HTTP API, Lambda functions, S3 + CloudFront distribution

## DynamoDB schema

Table name: `FinTrack`. Partition key: `pk`. Sort key: `sk`. One GSI: `gsi1pk` / `gsi1sk`.

| Entity   | pk          | sk            | GSI1 (pk / sk)                       |
|----------|-------------|---------------|--------------------------------------|
| Fund     | `FUND`      | `FUND#<id>`   | —                                    |
| Snapshot | `FUND#<id>` | `SNAP#<date>` | `SNAPSHOTS` / `<date>#FUND#<id>`     |

Snapshots denormalize fund name and category at write time. All monetary values are integer pence.
