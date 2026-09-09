import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Mirrors the table in infrastructure/lib/fintrack-stack.ts. Waits for the
// endpoint because the amazon/dynamodb-local image exposes nothing compose can
// use as a healthcheck, so the container is "up" before the JVM accepts
// connections. Pass a client with maxAttempts: 1 or the SDK's own retry makes
// each iteration of the wait loop take several seconds.
export async function ensureTable(
  client: DynamoDBClient,
  tableName: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
      return;
    } catch (err) {
      if ((err as { name?: string }).name === "ResourceNotFoundException") {
        await client.send(
          new CreateTableCommand({
            TableName: tableName,
            BillingMode: "PAY_PER_REQUEST",
            AttributeDefinitions: [
              { AttributeName: "pk", AttributeType: "S" },
              { AttributeName: "sk", AttributeType: "S" },
              { AttributeName: "gsi1pk", AttributeType: "S" },
              { AttributeName: "gsi1sk", AttributeType: "S" },
            ],
            KeySchema: [
              { AttributeName: "pk", KeyType: "HASH" },
              { AttributeName: "sk", KeyType: "RANGE" },
            ],
            GlobalSecondaryIndexes: [
              {
                IndexName: "GSI1",
                KeySchema: [
                  { AttributeName: "gsi1pk", KeyType: "HASH" },
                  { AttributeName: "gsi1sk", KeyType: "RANGE" },
                ],
                Projection: { ProjectionType: "ALL" },
              },
            ],
          }),
        );
        console.log(`Created table ${tableName}`);
        return;
      }
      lastError = err;
      await sleep(1000);
    }
  }

  throw new Error(
    `DynamoDB did not answer within ${timeoutMs}ms; last error: ${String(lastError)}`,
  );
}
