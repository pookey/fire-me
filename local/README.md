# Running FinTrack locally without AWS

Everything runs in Docker: DynamoDB Local, the Lambda handlers behind a small HTTP adapter, and the Vite dev server with Cognito replaced by a stub. No AWS account or credentials are needed.

```sh
docker compose -f local/compose.yaml up
```

Then open http://localhost:5180 and sign in. Accounts are local to this stack: signing in with an email address that has not been used before creates the account with that password, and each account sees only its own data. Passwords are checked on later sign-ins, but this is a convenience for sharing one machine, not security; the API is only reachable from localhost.

The first account created owns the pre-existing `FinTrack` table, so data from before accounts existed (or copied from AWS with the script below) belongs to whoever signs in first. Every later account gets its own table, `FinTrack_<userId>`. Account records and sessions live in a separate `FinTrackLocalAuth` table.

"Reset password with code" on the Login page works locally without a code: enter the account's email, anything in the code field, and the new password.

| Service | Port | Notes |
|---|---|---|
| frontend | 5180 | Vite dev server, hot reload from `frontend/` |
| api | 3000 | `backend/src/local/server.ts`, restarts on change to `backend/src/` |
| dynamodb | 8000 | DynamoDB Local, data persisted in the `fintrack-local_dynamodb-data` volume |

Host ports can be overridden with `FRONTEND_PORT`, `API_PORT` and `DYNAMODB_PORT` in the environment (5173 is avoided by default because a ddev router or another Vite project often holds it). All ports bind to 127.0.0.1 only. The local sign-in is a stand-in for Cognito with no rate limiting or verification, so the API must not be reachable from the network.

## Copying your data from AWS

One-off, run on the host with the compose stack up and your normal AWS credentials in the environment:

```sh
cd backend && npm install
npx tsx src/local/migrate.ts
```

By default this copies into the `FinTrack` table, which belongs to the first account created. To copy into another account's table, sign in as that account once so it exists, then set `LOCAL_USER=<email>`.

Env vars: `SOURCE_REGION` (default `eu-west-2`), `SOURCE_TABLE` (default `FinTrack`), `LOCAL_DYNAMODB_ENDPOINT` (default `http://localhost:8000`), `TABLE_NAME` (default `FinTrack`), `LOCAL_USER` (copy into that account's table instead), `LOCAL_AUTH_TABLE` (default `FinTrackLocalAuth`). `SOURCE_ENDPOINT` points the source at another DynamoDB Local instead of AWS, for rehearsing the copy. `LOCAL_ACCESS_KEY_ID` and `LOCAL_REGION` only matter if the destination is not running with `-sharedDb`, which the compose file always sets.

## Resetting the database

```sh
docker compose -f local/compose.yaml down -v
```

This removes every account and its data. Browsers that still hold a session token are signed out on their next page load.

## How it works, and keeping it rebaseable on upstream

The branch is purely additive: nothing outside `local/`, `backend/src/local/`, `frontend/src/local/` and `frontend/vite.local.config.ts` is touched, so rebasing onto upstream should never conflict. Two places can drift silently when upstream changes and are worth checking after a rebase:

- **Routes.** The adapter builds its route table at startup by scanning `backend/src/handlers/*.ts` for `routeKey === "METHOD /path"` literals, so new routes are picked up automatically. If upstream changes the dispatch style the adapter exits at boot with a "no routes found" error rather than 404ing silently.
- **Auth stub shape.** `frontend/src/local/auth.ts` is typed against the real `utils/auth.ts`, so `tsc -b` (part of `npm run build`) fails if upstream adds or changes an export the stub lacks. The stub is swapped in by a Vite plugin in `vite.local.config.ts`; the normal `npm run build` and `npm run dev` still use Cognito.

The backend handlers themselves need no change: the AWS SDK reads `AWS_ENDPOINT_URL_DYNAMODB` from the environment. Per-account isolation is done in the adapter rather than the handlers: the handlers never read the caller's identity and always address `TABLE_NAME`, so the adapter resolves the bearer token to an account and rewrites the table name on every DynamoDB call to that account's table. Two things to check after a rebase are whether the handlers still get the client from `utils/db.ts` (the rewrite is attached to that client) and whether any new command carries a table name somewhere other than `TableName` or `RequestItems`.
