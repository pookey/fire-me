import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { docClient, TABLE_NAME } from "../utils/db.js";
import { response } from "../utils/response.js";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const routeKey = event.routeKey;

    if (routeKey === "GET /fire-config") {
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { pk: "USER", sk: "FIRE_CONFIG" },
        })
      );

      if (!result.Item) {
        return response(404, { message: "FIRE config not found" });
      }

      return response(200, result.Item);
    }

    if (routeKey === "PUT /fire-config") {
      const body = JSON.parse(event.body ?? "{}");

      const item = {
        ...body,
        pk: "USER",
        sk: "FIRE_CONFIG",
      };

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        })
      );

      return response(200, item);
    }

    // --- Scenario CRUD ---

    if (routeKey === "GET /fire-scenarios") {
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: {
            ":pk": "USER",
            ":prefix": "FIRE_SCENARIO#",
          },
        })
      );

      const scenarios = (result.Items ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        config: item.config,
      }));

      return response(200, scenarios);
    }

    if (routeKey === "POST /fire-scenarios") {
      const body = JSON.parse(event.body ?? "{}");
      const id = randomUUID();

      const item = {
        pk: "USER",
        sk: `FIRE_SCENARIO#${id}`,
        id,
        name: body.name,
        config: body.config,
      };

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        })
      );

      return response(201, { id, name: body.name, config: body.config });
    }

    if (routeKey === "PUT /fire-scenarios/{id}") {
      const id = event.pathParameters?.id;
      if (!id) return response(400, { message: "Missing scenario id" });

      const body = JSON.parse(event.body ?? "{}");

      const item = {
        pk: "USER",
        sk: `FIRE_SCENARIO#${id}`,
        id,
        name: body.name,
        config: body.config,
      };

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        })
      );

      return response(200, { id, name: body.name, config: body.config });
    }

    if (routeKey === "DELETE /fire-scenarios/{id}") {
      const id = event.pathParameters?.id;
      if (!id) return response(400, { message: "Missing scenario id" });

      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: "USER", sk: `FIRE_SCENARIO#${id}` },
        })
      );

      return response(200, { message: "Scenario deleted" });
    }

    return response(404, { message: "Route not found" });
  } catch (error) {
    console.error("Error in fireConfigHandler:", error);
    return response(500, { message: "Internal server error" });
  }
};
