import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ScanCommand, PutCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../utils/db.js";
import { response } from "../utils/response.js";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const routeKey = event.routeKey;

    // -------------------------------------------------------
    // Income routes
    // -------------------------------------------------------
    if (routeKey === "GET /income") {
      const result = await docClient.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          FilterExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": "INCOME" },
        })
      );
      const items = (result.Items ?? []).map(item => ({
        ...item,
        id: item.id || item.sk?.replace("INCOME#", ""),
      }));
      return response(200, items);
    }

    if (routeKey === "POST /income") {
      const body = JSON.parse(event.body ?? "{}");
      const id = crypto.randomUUID();
      const item = {
        pk: "INCOME",
        sk: `INCOME#${id}`,
        id,
        name: body.name,
        type: body.type,
        annualAmount: body.annualAmount,
        taxable: body.taxable ?? true,
        active: body.active ?? true,
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return response(201, item);
    }

    if (routeKey === "PUT /income/{id}") {
      const id = event.pathParameters?.id;
      if (!id) return response(400, { message: "Missing income id" });

      const body = JSON.parse(event.body ?? "{}");
      const expressionParts: string[] = [];
      const expressionValues: Record<string, unknown> = {};
      const expressionNames: Record<string, string> = {};

      const updatableFields = ["name", "type", "annualAmount", "taxable", "active"];
      for (const field of updatableFields) {
        if (body[field] !== undefined) {
          expressionParts.push(`#${field} = :${field}`);
          expressionValues[`:${field}`] = body[field];
          expressionNames[`#${field}`] = field;
        }
      }

      if (expressionParts.length === 0) return response(400, { message: "No fields to update" });

      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: "INCOME", sk: `INCOME#${id}` },
          UpdateExpression: `SET ${expressionParts.join(", ")}`,
          ExpressionAttributeValues: expressionValues,
          ExpressionAttributeNames: expressionNames,
          ReturnValues: "ALL_NEW",
        })
      );
      return response(200, result.Attributes);
    }

    if (routeKey === "DELETE /income/{id}") {
      const id = event.pathParameters?.id;
      if (!id) return response(400, { message: "Missing income id" });

      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: "INCOME", sk: `INCOME#${id}` },
        })
      );
      return response(200, { message: "Income deleted" });
    }

    // -------------------------------------------------------
    // Expense routes
    // -------------------------------------------------------
    if (routeKey === "GET /expenses") {
      const result = await docClient.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          FilterExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": "EXPENSE" },
        })
      );
      const items = (result.Items ?? []).map(item => ({
        ...item,
        id: item.id || item.sk?.replace("EXPENSE#", ""),
      }));
      return response(200, items);
    }

    if (routeKey === "POST /expenses") {
      const body = JSON.parse(event.body ?? "{}");
      const id = crypto.randomUUID();
      const item = {
        pk: "EXPENSE",
        sk: `EXPENSE#${id}`,
        id,
        name: body.name,
        category: body.category,
        monthlyAmount: body.monthlyAmount,
        essential: body.essential ?? false,
        active: body.active ?? true,
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return response(201, item);
    }

    if (routeKey === "PUT /expenses/{id}") {
      const id = event.pathParameters?.id;
      if (!id) return response(400, { message: "Missing expense id" });

      const body = JSON.parse(event.body ?? "{}");
      const expressionParts: string[] = [];
      const expressionValues: Record<string, unknown> = {};
      const expressionNames: Record<string, string> = {};

      const updatableFields = ["name", "category", "monthlyAmount", "essential", "active"];
      for (const field of updatableFields) {
        if (body[field] !== undefined) {
          expressionParts.push(`#${field} = :${field}`);
          expressionValues[`:${field}`] = body[field];
          expressionNames[`#${field}`] = field;
        }
      }

      if (expressionParts.length === 0) return response(400, { message: "No fields to update" });

      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: "EXPENSE", sk: `EXPENSE#${id}` },
          UpdateExpression: `SET ${expressionParts.join(", ")}`,
          ExpressionAttributeValues: expressionValues,
          ExpressionAttributeNames: expressionNames,
          ReturnValues: "ALL_NEW",
        })
      );
      return response(200, result.Attributes);
    }

    if (routeKey === "DELETE /expenses/{id}") {
      const id = event.pathParameters?.id;
      if (!id) return response(400, { message: "Missing expense id" });

      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: "EXPENSE", sk: `EXPENSE#${id}` },
        })
      );
      return response(200, { message: "Expense deleted" });
    }

    return response(404, { message: "Route not found" });
  } catch (error) {
    console.error("Error in incomeExpensesHandler:", error);
    return response(500, { message: "Internal server error" });
  }
};
