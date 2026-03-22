import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ScanCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { docClient, TABLE_NAME } from "../utils/db.js";
import { response } from "../utils/response.js";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const routeKey = event.routeKey;

    if (routeKey === "GET /funds") {
      const result = await docClient.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          FilterExpression: "pk = :pk",
          ExpressionAttributeValues: {
            ":pk": "FUND",
          },
        })
      );
      const funds = (result.Items ?? []).map(item => ({
        ...item,
        id: item.id || item.sk?.replace("FUND#", ""),
      }));
      return response(200, funds);
    }

    if (routeKey === "POST /funds") {
      const body = JSON.parse(event.body ?? "{}");
      const id = uuidv4();
      const item: Record<string, unknown> = {
        pk: "FUND",
        sk: `FUND#${id}`,
        id,
        name: body.name,
        category: body.category,
        subcategory: body.subcategory,
        wrapper: body.wrapper ?? 'none',
        active: body.active ?? true,
        sortOrder: body.sortOrder ?? 0,
      };
      if (body.description !== undefined) item.description = body.description;
      if (body.drawdownAge !== undefined) item.drawdownAge = body.drawdownAge;
      if (body.monthlyContribution !== undefined) item.monthlyContribution = body.monthlyContribution;
      if (body.contributionEndAge !== undefined) item.contributionEndAge = body.contributionEndAge;
      if (body.take25PctLumpSum !== undefined) item.take25PctLumpSum = body.take25PctLumpSum;

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        })
      );

      return response(201, item);
    }

    if (routeKey === "PUT /funds/{id}") {
      const id = event.pathParameters?.id;
      if (!id) {
        return response(400, { message: "Missing fund id" });
      }

      const body = JSON.parse(event.body ?? "{}");
      const expressionParts: string[] = [];
      const expressionValues: Record<string, unknown> = {};
      const expressionNames: Record<string, string> = {};

      const updatableFields = ["name", "description", "category", "subcategory", "wrapper", "active", "sortOrder", "drawdownAge", "monthlyContribution", "contributionEndAge", "take25PctLumpSum"];
      for (const field of updatableFields) {
        if (body[field] !== undefined) {
          expressionParts.push(`#${field} = :${field}`);
          expressionValues[`:${field}`] = body[field];
          expressionNames[`#${field}`] = field;
        }
      }

      if (expressionParts.length === 0) {
        return response(400, { message: "No fields to update" });
      }

      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: "FUND", sk: `FUND#${id}` },
          UpdateExpression: `SET ${expressionParts.join(", ")}`,
          ExpressionAttributeValues: expressionValues,
          ExpressionAttributeNames: expressionNames,
          ReturnValues: "ALL_NEW",
        })
      );

      return response(200, result.Attributes);
    }

    return response(404, { message: "Route not found" });
  } catch (error) {
    console.error("Error in fundsHandler:", error);
    return response(500, { message: "Internal server error" });
  }
};
