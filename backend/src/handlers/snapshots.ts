import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  QueryCommand,
  PutCommand,
  DeleteCommand,
  GetCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../utils/db.js";
import { response } from "../utils/response.js";

function normalizeSnapshot(item: Record<string, unknown>) {
  return {
    ...item,
    fundId: item.fundId || (item.pk as string)?.replace("FUND#", ""),
    date: item.date || (item.sk as string)?.replace("SNAP#", ""),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const routeKey = event.routeKey;

    if (routeKey === "GET /funds/{id}/snapshots") {
      const id = event.pathParameters?.id;
      if (!id) {
        return response(400, { message: "Missing fund id" });
      }

      const from = event.queryStringParameters?.from;
      const to = event.queryStringParameters?.to;

      let keyCondition = "pk = :pk AND begins_with(sk, :skPrefix)";
      const expressionValues: Record<string, unknown> = {
        ":pk": `FUND#${id}`,
        ":skPrefix": "SNAP#",
      };

      let filterExpression: string | undefined;
      if (from || to) {
        const filterParts: string[] = [];
        if (from) {
          filterParts.push("#date >= :from");
          expressionValues[":from"] = from;
        }
        if (to) {
          filterParts.push("#date <= :to");
          expressionValues[":to"] = to;
        }
        filterExpression = filterParts.join(" AND ");
      }

      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: keyCondition,
          ExpressionAttributeValues: expressionValues,
          ...(filterExpression && {
            FilterExpression: filterExpression,
            ExpressionAttributeNames: { "#date": "date" },
          }),
        })
      );

      return response(200, (result.Items ?? []).map(normalizeSnapshot));
    }

    if (routeKey === "POST /funds/{id}/snapshots") {
      const id = event.pathParameters?.id;
      if (!id) {
        return response(400, { message: "Missing fund id" });
      }

      const body = JSON.parse(event.body ?? "{}");

      // Look up fund info for denormalization
      const fundResult = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { pk: "FUND", sk: `FUND#${id}` },
        })
      );

      if (!fundResult.Item) {
        return response(404, { message: "Fund not found" });
      }

      const fund = fundResult.Item;
      const item = {
        pk: `FUND#${id}`,
        sk: `SNAP#${body.date}`,
        date: body.date,
        value: body.value,
        fundId: id,
        fundName: fund.name,
        category: fund.category,
        gsi1pk: "SNAPSHOTS",
        gsi1sk: `${body.date}#FUND#${id}`,
      };

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        })
      );

      return response(201, item);
    }

    if (routeKey === "DELETE /funds/{id}/snapshots/{date}") {
      const id = event.pathParameters?.id;
      const date = event.pathParameters?.date;
      if (!id || !date) {
        return response(400, { message: "Missing fund id or date" });
      }

      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: `FUND#${id}`, sk: `SNAP#${date}` },
        })
      );

      return response(200, { message: "Snapshot deleted" });
    }

    if (routeKey === "POST /snapshots/batch") {
      const body = JSON.parse(event.body ?? "{}");
      const { date, values } = body as {
        date: string;
        values: Array<{ fundId: string; value: number }>;
      };

      // Look up all fund info for denormalization
      const fundLookups = await Promise.all(
        values.map((v) =>
          docClient.send(
            new GetCommand({
              TableName: TABLE_NAME,
              Key: { pk: "FUND", sk: `FUND#${v.fundId}` },
            })
          )
        )
      );

      const items = values.map((v, i) => {
        const fund = fundLookups[i].Item;
        return {
          pk: `FUND#${v.fundId}`,
          sk: `SNAP#${date}`,
          date,
          value: v.value,
          fundId: v.fundId,
          fundName: fund?.name ?? "Unknown",
          category: fund?.category ?? "Unknown",
          gsi1pk: "SNAPSHOTS",
          gsi1sk: `${date}#FUND#${v.fundId}`,
        };
      });

      // BatchWrite in chunks of 25
      const chunks: typeof items[] = [];
      for (let i = 0; i < items.length; i += 25) {
        chunks.push(items.slice(i, i + 25));
      }

      for (const chunk of chunks) {
        await docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [TABLE_NAME]: chunk.map((item) => ({
                PutRequest: { Item: item },
              })),
            },
          })
        );
      }

      return response(201, { message: "Batch snapshots created", count: items.length });
    }

    if (routeKey === "GET /snapshots") {
      const from = event.queryStringParameters?.from;
      const to = event.queryStringParameters?.to;

      if (!from || !to) {
        return response(400, { message: "Both 'from' and 'to' query parameters are required" });
      }

      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: "GSI1",
          KeyConditionExpression: "gsi1pk = :pk AND gsi1sk BETWEEN :from AND :to",
          ExpressionAttributeValues: {
            ":pk": "SNAPSHOTS",
            ":from": `${from}#`,
            ":to": `${to}#~`,
          },
        })
      );

      return response(200, (result.Items ?? []).map(normalizeSnapshot));
    }

    return response(404, { message: "Route not found" });
  } catch (error) {
    console.error("Error in snapshotsHandler:", error);
    return response(500, { message: "Internal server error" });
  }
};
