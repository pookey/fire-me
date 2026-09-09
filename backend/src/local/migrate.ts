// Copies the production FinTrack table into DynamoDB Local. Run on the host:
//
//   SOURCE_REGION=eu-west-2 SOURCE_TABLE=FinTrack \
//   LOCAL_DYNAMODB_ENDPOINT=http://localhost:8000 TABLE_NAME=FinTrack \
//   npx tsx src/local/migrate.ts
//
// The source client needs whatever AWS credentials you normally use (profile,
// SSO, env vars). The values above are the defaults.

import {
  BatchWriteItemCommand,
  DynamoDBClient,
  ScanCommand,
  type AttributeValue,
  type WriteRequest,
} from "@aws-sdk/client-dynamodb";
import { ensureTable } from "./ensureTable.js";

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

  await ensureTable(destination, LOCAL_TABLE);

  let copied = 0;
  for await (const page of scanAll(source, SOURCE_TABLE)) {
    for (let i = 0; i < page.length; i += 25) {
      await batchWrite(destination, LOCAL_TABLE, page.slice(i, i + 25));
    }
    copied += page.length;
    console.log(`Copied ${copied} items...`);
  }
  console.log(`Done: ${copied} items from ${SOURCE_TABLE} (${SOURCE_REGION}) to ${LOCAL_TABLE} at ${LOCAL_ENDPOINT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
