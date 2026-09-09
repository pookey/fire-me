import { AsyncLocalStorage } from "node:async_hooks";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export interface TableContext {
  tableName: string;
}

// Carries the signed-in user's table through the handler call so the handlers,
// which read TABLE_NAME once at import and cannot be changed, still land in a
// per-user table.
export const als = new AsyncLocalStorage<TableContext>();

interface TableInput {
  TableName?: string;
  RequestItems?: Record<string, unknown>;
}

// Rewrites the table name on every command the handlers send. Registered at
// the initialize step: lib-dynamodb's DocumentMarshall middleware sits before
// serializerMiddleware in the serialize step, so initialize always runs first
// and sees the plain document input, but the order does not matter anyway
// because marshalling copies the input and only touches Item/Key values, never
// TableName or the RequestItems keys.
export function installTableRewrite(docClient: DynamoDBDocumentClient, baseTable: string): void {
  let logged = false;

  docClient.middlewareStack.add(
    (next) => async (args) => {
      const store = als.getStore();
      if (!store) {
        throw new Error("DynamoDB command sent outside a request context; refusing to use the shared table");
      }
      if (!logged) {
        logged = true;
        console.debug(`table ${baseTable} -> ${store.tableName}`);
      }
      const input = args.input as TableInput;
      const rewritten: TableInput = { ...input };
      if (input.TableName === baseTable) rewritten.TableName = store.tableName;
      if (input.RequestItems && baseTable in input.RequestItems) {
        const { [baseTable]: requests, ...rest } = input.RequestItems;
        rewritten.RequestItems = { ...rest, [store.tableName]: requests };
      }
      return next({ ...args, input: rewritten });
    },
    { step: "initialize", name: "LocalTableRewrite", override: true },
  );
}
