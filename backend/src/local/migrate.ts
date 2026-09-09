// Copies the production FinTrack table into DynamoDB Local. Run on the host:
//
//   SOURCE_REGION=eu-west-2 SOURCE_TABLE=FinTrack \
//   LOCAL_DYNAMODB_ENDPOINT=http://localhost:8000 TABLE_NAME=FinTrack \
//   npx tsx src/local/migrate.ts
//
// The source client needs whatever AWS credentials you normally use (profile,
// SSO, env vars). The values above are the defaults.
//
// The destination is TABLE_NAME, which the first local account to sign in
// takes over. Set LOCAL_USER=<email> to copy into a specific account's table
// instead; that account must already have signed in once so its table exists.

import {
  BatchWriteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  type AttributeValue,
  type WriteRequest,
} from "@aws-sdk/client-dynamodb";
import { ensureTable } from "./ensureTable.js";
import { LOCAL_AUTH_TABLE, profileKey } from "./auth.js";

// Removed rather than ignored: the SDK applies these to every client that does
// not set `endpoint` explicitly, so a shell that exports them for the server
// would point the source client at DynamoDB Local and copy local to local.
delete process.env.AWS_ENDPOINT_URL_DYNAMODB;
delete process.env.AWS_ENDPOINT_URL;

type Item = Record<string, AttributeValue>;

const SOURCE_REGION = process.env.SOURCE_REGION ?? "eu-west-2";
const SOURCE_TABLE = process.env.SOURCE_TABLE ?? "FinTrack";
const LOCAL_ENDPOINT = process.env.LOCAL_DYNAMODB_ENDPOINT ?? "http://localhost:8000";
const LOCAL_TABLE = process.env.TABLE_NAME ?? "FinTrack";
const LOCAL_USER = process.env.LOCAL_USER;
// Lets the copy be rehearsed against a throwaway DynamoDB Local instead of AWS.
const SOURCE_ENDPOINT = process.env.SOURCE_ENDPOINT;
// Without -sharedDb, DynamoDB Local keeps a separate database per access key
// and region, so these must match what the server uses or it will not see the
// copied data. Both are explicit rather than taken from the environment because
// on the host AWS_ACCESS_KEY_ID / AWS_REGION may hold real credentials.
const LOCAL_ACCESS_KEY_ID = process.env.LOCAL_ACCESS_KEY_ID ?? "local";
const LOCAL_REGION = process.env.LOCAL_REGION ?? "eu-west-2";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function* scanAll(client: DynamoDBClient, tableName: string): AsyncGenerator<Item[]> {
  let startKey: Item | undefined;
  do {
    const page = await client.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey: startKey }),
    );
    yield page.Items ?? [];
    startKey = page.LastEvaluatedKey;
  } while (startKey);
}

async function batchWrite(client: DynamoDBClient, tableName: string, items: Item[]) {
  let requests: WriteRequest[] = items.map((item) => ({ PutRequest: { Item: item } }));
  let delay = 100;
  while (requests.length > 0) {
    const result = await client.send(
      new BatchWriteItemCommand({ RequestItems: { [tableName]: requests } }),
    );
    requests = result.UnprocessedItems?.[tableName] ?? [];
    if (requests.length > 0) {
      await sleep(delay);
      delay = Math.min(delay * 2, 2000);
    }
  }
}

async function destinationTable(client: DynamoDBClient): Promise<string> {
  if (!LOCAL_USER) return LOCAL_TABLE;
  const missing = new Error(
    `No local account for ${LOCAL_USER} in ${LOCAL_AUTH_TABLE}; sign in to the local frontend first`,
  );
  let tableName: string | undefined;
  try {
    const result = await client.send(
      new GetItemCommand({
        TableName: LOCAL_AUTH_TABLE,
        Key: { pk: { S: profileKey(LOCAL_USER) }, sk: { S: "PROFILE" } },
      }),
    );
    tableName = result.Item?.tableName?.S;
  } catch (err) {
    // The auth table itself only exists once the server has booted.
    if ((err as { name?: string }).name !== "ResourceNotFoundException") throw err;
  }
  if (!tableName) throw missing;
  return tableName;
}

async function main() {
  const source = new DynamoDBClient({
    region: SOURCE_REGION,
    ...(SOURCE_ENDPOINT && {
      endpoint: SOURCE_ENDPOINT,
      credentials: { accessKeyId: "source", secretAccessKey: "source" },
    }),
  });
  const destination = new DynamoDBClient({
    endpoint: LOCAL_ENDPOINT,
    region: LOCAL_REGION,
    credentials: { accessKeyId: LOCAL_ACCESS_KEY_ID, secretAccessKey: "local" },
    maxAttempts: 1,
  });

  const target = await destinationTable(destination);
  await ensureTable(destination, target);

  let copied = 0;
  for await (const page of scanAll(source, SOURCE_TABLE)) {
    for (let i = 0; i < page.length; i += 25) {
      await batchWrite(destination, target, page.slice(i, i + 25));
    }
    copied += page.length;
    console.log(`Copied ${copied} items...`);
  }
  console.log(`Done: ${copied} items from ${SOURCE_TABLE} (${SOURCE_REGION}) to ${target} at ${LOCAL_ENDPOINT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
