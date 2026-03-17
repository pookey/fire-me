import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { parse } from "csv-parse/sync";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AWS_PROFILE = process.env.AWS_PROFILE || "default";
const AWS_REGION = "eu-west-2";
const TABLE_NAME = "FinTrack";
const CSV_PATH = resolve(
  process.cwd(),
  process.env.CSV_PATH || "../data.csv"
);

// Existing fund IDs from DynamoDB, mapped by CSV row index
const FUND_MAP: Array<{ rowIndex: number; fundId: string; name: string }> = [
  { rowIndex: 5, fundId: "91432202-0be9-4017-aeea-148f39740675", name: "Mortgage Equity" },
  { rowIndex: 6, fundId: "b792764c-da7b-443e-a876-a9d5005ce647", name: "Premium Bonds" },
  { rowIndex: 7, fundId: "e0445679-a4ac-41d0-9df1-392d1915af20", name: "Emergency Fund" },
  { rowIndex: 8, fundId: "c3ef9992-ac08-4459-9a23-0becf611b0f3", name: "Vanguard ISA" },
  { rowIndex: 9, fundId: "a686ac10-6f9a-4263-b21f-6bbfd6d65f51", name: "Vanguard GIA" },
  { rowIndex: 10, fundId: "cfd63549-db00-41fa-b3f6-e70325ee5bfe", name: "Nutmeg ISA" },
  { rowIndex: 11, fundId: "9694f1db-8b90-4da9-8184-0540609ddc59", name: "Nutmeg LISA" },
  { rowIndex: 12, fundId: "f38dba00-f291-4857-bab0-2bb7ff44d532", name: "Nutmeg Pension" },
  { rowIndex: 13, fundId: "0769f52a-b4d1-463d-9262-a8e6daa9741d", name: "Aviva Pension" },
  { rowIndex: 14, fundId: "8a5a04b3-df2f-43cc-a728-e73dd8a9f8b3", name: "NowPensions" },
  { rowIndex: 15, fundId: "52c92907-6129-4d2e-ac04-344436e233eb", name: "Vanguard Pension" },
  { rowIndex: 16, fundId: "1d973984-2288-4981-9d69-db1dac7614a4", name: "Scottish Widows" },
  { rowIndex: 17, fundId: "dad62341-19af-4c7f-a3d2-80f9e814eb0f", name: "Stocks" },
];

const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04",
  May: "05", Jun: "06", Jul: "07", Aug: "08",
  Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseDate(header: string): string | null {
  const trimmed = header.trim();
  const monYYMatch = trimmed.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (monYYMatch) {
    const month = MONTH_MAP[monYYMatch[1]];
    if (!month) return null;
    const year = parseInt(monYYMatch[2], 10);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return `${fullYear}-${month}-01`;
  }
  const mdyyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdyyMatch) {
    const month = mdyyMatch[1].padStart(2, "0");
    const year = parseInt(mdyyMatch[3], 10);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return `${fullYear}-${month}-01`;
  }
  return null;
}

function parseGBPToPence(raw: string): number | null {
  let cleaned = raw.replace(/[\s"]/g, "");
  if (cleaned === "") return null;
  if (cleaned === "£-" || cleaned === "-£-") return 0;
  if (cleaned === "£0.00" || cleaned === "-£0.00") return 0;
  let negative = false;
  if (cleaned.startsWith("-")) {
    negative = true;
    cleaned = cleaned.substring(1);
  }
  cleaned = cleaned.replace("£", "").replace(/,/g, "");
  if (cleaned === "-" || cleaned === "") return 0;
  const value = parseFloat(cleaned);
  if (isNaN(value)) return null;
  const pence = Math.round(value * 100);
  return negative ? -pence : pence;
}

interface WriteRequest {
  PutRequest: { Item: Record<string, unknown> };
}

async function batchWrite(docClient: DynamoDBDocumentClient, items: WriteRequest[]): Promise<void> {
  const BATCH_SIZE = 25;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    let response = await docClient.send(new BatchWriteCommand({
      RequestItems: { [TABLE_NAME]: chunk },
    }));
    let retries = 0;
    while (response.UnprocessedItems?.[TABLE_NAME]?.length && retries < 5) {
      await new Promise((r) => setTimeout(r, Math.pow(2, retries) * 100));
      response = await docClient.send(new BatchWriteCommand({ RequestItems: response.UnprocessedItems }));
      retries++;
    }
  }
}

async function main(): Promise<void> {
  console.log("FinTrack Backfill £0 Snapshots\n");

  const csvContent = readFileSync(CSV_PATH, "utf-8");
  const rows: string[][] = parse(csvContent, { relax_column_count: true, relax_quotes: true });

  const headers = rows[0];
  const dateColumns: Array<{ colIndex: number; date: string }> = [];
  for (let i = 1; i < headers.length; i++) {
    const date = parseDate(headers[i]);
    if (date) dateColumns.push({ colIndex: i, date });
  }

  const client = new DynamoDBClient({
    region: AWS_REGION,
    credentials: fromIni({ profile: AWS_PROFILE }),
  });
  const docClient = DynamoDBDocumentClient.from(client);

  let totalAdded = 0;

  for (const fund of FUND_MAP) {
    const row = rows[fund.rowIndex];
    if (!row) continue;

    // Parse all values for this fund
    const values: Array<{ colIndex: number; date: string; pence: number | null }> = [];
    for (const { colIndex, date } of dateColumns) {
      const rawValue = row[colIndex] ?? "";
      values.push({ colIndex, date, pence: parseGBPToPence(rawValue) });
    }

    // Find first and last columns with actual data
    let firstDataIdx = -1;
    let lastDataIdx = -1;
    for (let i = 0; i < values.length; i++) {
      if (values[i].pence !== null) {
        if (firstDataIdx === -1) firstDataIdx = i;
        lastDataIdx = i;
      }
    }

    if (firstDataIdx === -1) continue;

    // Find gaps: empty cells between first and last data, plus trailing empties after last data
    const writeRequests: WriteRequest[] = [];
    for (let i = firstDataIdx; i < values.length; i++) {
      const { date, pence } = values[i];
      // Write £0 for: empty cells after first data, and explicit £0 values that were previously skipped
      if (pence === null && i <= lastDataIdx) {
        // Gap in the middle — treat as £0
        writeRequests.push({
          PutRequest: {
            Item: {
              pk: `FUND#${fund.fundId}`,
              sk: `SNAP#${date}`,
              value: 0,
              fundId: fund.fundId,
              fundName: fund.name,
              date: date,
              gsi1pk: "SNAPSHOTS",
              gsi1sk: `${date}#FUND#${fund.fundId}`,
            },
          },
        });
      } else if (pence === 0) {
        // Explicit £0/£- that was previously skipped
        writeRequests.push({
          PutRequest: {
            Item: {
              pk: `FUND#${fund.fundId}`,
              sk: `SNAP#${date}`,
              value: 0,
              fundId: fund.fundId,
              fundName: fund.name,
              date: date,
              gsi1pk: "SNAPSHOTS",
              gsi1sk: `${date}#FUND#${fund.fundId}`,
            },
          },
        });
      }
    }

    if (writeRequests.length > 0) {
      console.log(`  ${fund.name}: adding ${writeRequests.length} zero-value snapshots`);
      for (const req of writeRequests) {
        const item = req.PutRequest.Item;
        console.log(`    ${item.date}: £0`);
      }
      await batchWrite(docClient, writeRequests);
      totalAdded += writeRequests.length;
    }
  }

  console.log(`\nDone! Added ${totalAdded} zero-value snapshots.`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
