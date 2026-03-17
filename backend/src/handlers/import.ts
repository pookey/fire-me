import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { docClient, TABLE_NAME } from "../utils/db.js";
import { response } from "../utils/response.js";

interface ImportFund {
  name: string;
  category: string;
  subcategory: string;
  active?: boolean;
  sortOrder?: number;
}

interface ImportSnapshot {
  fundId: string;
  date: string;
  value: number;
  fundName: string;
  category: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const routeKey = event.routeKey;

    if (routeKey === "POST /import") {
      const body = JSON.parse(event.body ?? "{}");
      const funds: ImportFund[] = body.funds ?? [];
      const snapshots: ImportSnapshot[] = body.snapshots ?? [];

      const fundItems = funds.map((fund) => {
        const id = uuidv4();
        return {
          PutRequest: {
            Item: {
              pk: "FUND",
              sk: `FUND#${id}`,
              id,
              name: fund.name,
              category: fund.category,
              subcategory: fund.subcategory,
              active: fund.active ?? true,
              sortOrder: fund.sortOrder ?? 0,
            },
          },
        };
      });

      const snapshotItems = snapshots.map((snap) => ({
        PutRequest: {
          Item: {
            pk: `FUND#${snap.fundId}`,
            sk: `SNAP#${snap.date}`,
            date: snap.date,
            value: snap.value,
            fundId: snap.fundId,
            fundName: snap.fundName,
            category: snap.category,
            gsi1pk: "SNAPSHOTS",
            gsi1sk: `${snap.date}#FUND#${snap.fundId}`,
          },
        },
      }));

      const allItems = [...fundItems, ...snapshotItems];

      // BatchWrite in chunks of 25
      const chunks = [];
      for (let i = 0; i < allItems.length; i += 25) {
        chunks.push(allItems.slice(i, i + 25));
      }

      for (const chunk of chunks) {
        await docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [TABLE_NAME]: chunk,
            },
          })
        );
      }

      return response(200, {
        message: "Import complete",
        fundsImported: funds.length,
        snapshotsImported: snapshots.length,
      });
    }

    return response(404, { message: "Route not found" });
  } catch (error) {
    console.error("Error in importHandler:", error);
    return response(500, { message: "Internal server error" });
  }
};
