import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { parse } from "csv-parse/sync";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// --- Configuration ---

const AWS_PROFILE = process.env.AWS_PROFILE || "default";
const AWS_REGION = "eu-west-2";
const TABLE_NAME = "FinTrack";
const CSV_PATH = resolve(
  process.cwd(),
  process.env.CSV_PATH || "../data.csv"
);

// Fund definitions: rows 6-18 (0-indexed rows 5-17 in parsed data)
const FUND_DEFINITIONS: Array<{
  rowIndex: number; // 0-indexed row in parsed CSV (row 6 in spreadsheet = index 5)
  name: string;
  category: string;
  subcategory: string;
  wrapper?: string;
  active: boolean;
}> = [
  { rowIndex: 5, name: "Mortgage Equity", category: "property", subcategory: "property", active: true },
  { rowIndex: 6, name: "Premium Bonds", category: "savings", subcategory: "cash", active: true },
  { rowIndex: 7, name: "Emergency Fund", category: "savings", subcategory: "cash", active: true },
  { rowIndex: 8, name: "Vanguard ISA", category: "savings", subcategory: "equities", wrapper: "isa", active: true },
  { rowIndex: 9, name: "Vanguard GIA", category: "savings", subcategory: "equities", wrapper: "gia", active: true },
  { rowIndex: 10, name: "Nutmeg ISA", category: "savings", subcategory: "equities", wrapper: "isa", active: false },
  { rowIndex: 11, name: "Nutmeg LISA", category: "savings", subcategory: "equities", wrapper: "lisa", active: true },
  { rowIndex: 12, name: "Nutmeg Pension", category: "pension", subcategory: "equities", wrapper: "sipp", active: true },
  { rowIndex: 13, name: "Aviva Pension", category: "pension", subcategory: "equities", wrapper: "sipp", active: true },
  { rowIndex: 14, name: "NowPensions", category: "pension", subcategory: "equities", wrapper: "sipp", active: false },
  { rowIndex: 15, name: "Vanguard Pension", category: "pension", subcategory: "equities", wrapper: "sipp", active: true },
  { rowIndex: 16, name: "Scottish Widows", category: "pension", subcategory: "equities", wrapper: "sipp", active: true },
  { rowIndex: 17, name: "Stocks", category: "savings", subcategory: "equities", wrapper: "gia", active: true },
];

// --- Date Parsing ---

const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04",
  May: "05", Jun: "06", Jul: "07", Aug: "08",
  Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseDate(header: string): string | null {
  const trimmed = header.trim();

  // Format: "Mon-YY" e.g. "Nov-18" -> "2018-11-01"
  const monYYMatch = trimmed.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (monYYMatch) {
    const month = MONTH_MAP[monYYMatch[1]];
    if (!month) return null;
    const year = parseInt(monYYMatch[2], 10);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return `${fullYear}-${month}-01`;
  }

  // Format: "M/D/YY" e.g. "4/1/26" -> "2026-04-01"
  const mdyyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdyyMatch) {
    const month = mdyyMatch[1].padStart(2, "0");
    const year = parseInt(mdyyMatch[3], 10);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return `${fullYear}-${month}-01`;
  }

  return null;
}

// --- Value Parsing ---

function parseGBPToPence(raw: string): number | null {
  // Strip all whitespace and quotes
  let cleaned = raw.replace(/[\s"]/g, "");

  // Empty string -> skip
  if (cleaned === "") return null;

  // £- or £0.00 variants
  if (cleaned === "£-" || cleaned === "-£-") return 0;
  if (cleaned === "£0.00" || cleaned === "-£0.00") return null;

  // Detect negative: could be "-£..." or "£-..."
  let negative = false;
  if (cleaned.startsWith("-")) {
    negative = true;
    cleaned = cleaned.substring(1);
  }

  // Remove £ sign
  cleaned = cleaned.replace("£", "");

  // Remove commas
  cleaned = cleaned.replace(/,/g, "");

  // Handle bare "-" (£- after removing £)
  if (cleaned === "-" || cleaned === "") return 0;

  const value = parseFloat(cleaned);
  if (isNaN(value)) return null;

  const pence = Math.round(value * 100);
  return negative ? -pence : pence;
}

// --- DynamoDB helpers ---

interface WriteRequest {
  PutRequest: {
    Item: Record<string, unknown>;
  };
}

async function batchWrite(
  docClient: DynamoDBDocumentClient,
  items: WriteRequest[]
): Promise<void> {
  const BATCH_SIZE = 25;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    const command = new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: chunk,
      },
    });

    let response = await docClient.send(command);

    // Handle unprocessed items with exponential backoff
    let retries = 0;
    while (
      response.UnprocessedItems &&
      response.UnprocessedItems[TABLE_NAME] &&
      response.UnprocessedItems[TABLE_NAME].length > 0 &&
      retries < 5
    ) {
      const delay = Math.pow(2, retries) * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
      const retryCommand = new BatchWriteCommand({
        RequestItems: response.UnprocessedItems,
      });
      response = await docClient.send(retryCommand);
      retries++;
    }

    if (
      response.UnprocessedItems &&
      response.UnprocessedItems[TABLE_NAME] &&
      response.UnprocessedItems[TABLE_NAME].length > 0
    ) {
      console.error(
        `WARNING: ${response.UnprocessedItems[TABLE_NAME].length} items were not processed after retries`
      );
    }
  }
}

// --- Main ---

async function main(): Promise<void> {
  console.log("FinTrack CSV Import");
  console.log("===================\n");

  // Read and parse CSV
  console.log(`Reading CSV: ${CSV_PATH}`);
  const csvContent = readFileSync(CSV_PATH, "utf-8");
  const rows: string[][] = parse(csvContent, {
    relax_column_count: true,
    relax_quotes: true,
  });

  console.log(`Parsed ${rows.length} rows\n`);

  // Extract headers (row 0)
  const headers = rows[0];
  const dateColumns: Array<{ colIndex: number; date: string }> = [];

  for (let i = 1; i < headers.length; i++) {
    const date = parseDate(headers[i]);
    if (date) {
      dateColumns.push({ colIndex: i, date });
    }
  }

  console.log(`Found ${dateColumns.length} date columns`);
  console.log(
    `Date range: ${dateColumns[0]?.date} to ${dateColumns[dateColumns.length - 1]?.date}\n`
  );

  // Initialize DynamoDB client
  const client = new DynamoDBClient({
    region: AWS_REGION,
    credentials: fromIni({ profile: AWS_PROFILE }),
  });
  const docClient = DynamoDBDocumentClient.from(client);

  // Step 1: Create fund records
  console.log("--- Creating Fund Records ---\n");

  const fundRecords: Array<{
    id: string;
    name: string;
    category: string;
    subcategory: string;
    wrapper?: string;
    active: boolean;
    sortOrder: number;
    rowIndex: number;
  }> = [];

  const fundWriteRequests: WriteRequest[] = [];

  for (let i = 0; i < FUND_DEFINITIONS.length; i++) {
    const def = FUND_DEFINITIONS[i];
    const fundId = uuidv4();

    fundRecords.push({
      id: fundId,
      name: def.name,
      category: def.category,
      subcategory: def.subcategory,
      wrapper: def.wrapper,
      active: def.active,
      sortOrder: i,
      rowIndex: def.rowIndex,
    });

    const fundItem: Record<string, unknown> = {
      pk: "FUND",
      sk: `FUND#${fundId}`,
      id: fundId,
      name: def.name,
      category: def.category,
      subcategory: def.subcategory,
      active: def.active,
      sortOrder: i,
    };
    if (def.wrapper) fundItem.wrapper = def.wrapper;

    fundWriteRequests.push({
      PutRequest: {
        Item: fundItem,
      },
    });

    console.log(
      `  Fund: ${def.name} (${def.category}/${def.subcategory}) -> ${fundId}${def.active ? "" : " [INACTIVE]"}`
    );
  }

  console.log(`\nWriting ${fundWriteRequests.length} fund records...`);
  await batchWrite(docClient, fundWriteRequests);
  console.log("Fund records written.\n");

  // Step 2: Create snapshot records
  console.log("--- Creating Snapshot Records ---\n");

  let totalSnapshots = 0;

  for (const fund of fundRecords) {
    const row = rows[fund.rowIndex];
    if (!row) {
      console.warn(`  WARNING: No row data for ${fund.name} at index ${fund.rowIndex}`);
      continue;
    }

    const snapshotRequests: WriteRequest[] = [];

    // First pass: find the last column with actual data for this fund
    let lastDataCol = -1;
    for (const { colIndex } of dateColumns) {
      const rawValue = row[colIndex] ?? "";
      const pence = parseGBPToPence(rawValue);
      if (pence !== null) {
        lastDataCol = colIndex;
      }
    }

    // Second pass: write snapshots, treating empty cells after first
    // data point (but before last data point) as £0 (closed account)
    let hasSeenData = false;
    for (const { colIndex, date } of dateColumns) {
      const rawValue = row[colIndex] ?? "";
      const pence = parseGBPToPence(rawValue);

      if (pence !== null) {
        hasSeenData = true;
      }

      // Skip leading empties (fund didn't exist yet)
      if (!hasSeenData) continue;

      // After the fund has had data, treat empties as £0 (account closed)
      // but stop after the last date column in the CSV
      const value = pence ?? 0;

      // Skip if we're past the last column with data and value is 0
      // (don't generate future £0 snapshots beyond what the CSV covers)
      if (colIndex > lastDataCol && value === 0) continue;

      snapshotRequests.push({
        PutRequest: {
          Item: {
            pk: `FUND#${fund.id}`,
            sk: `SNAP#${date}`,
            fundId: fund.id,
            date: date,
            value: value,
            fundName: fund.name,
            category: fund.category,
            gsi1pk: "SNAPSHOTS",
            gsi1sk: `${date}#FUND#${fund.id}`,
          },
        },
      });
    }

    console.log(`  Importing fund: ${fund.name}... ${snapshotRequests.length} snapshots`);

    if (snapshotRequests.length > 0) {
      await batchWrite(docClient, snapshotRequests);
    }

    totalSnapshots += snapshotRequests.length;
  }

  // Summary
  console.log("\n===================");
  console.log("Import Complete!");
  console.log(`  Total funds: ${fundRecords.length}`);
  console.log(`  Total snapshots: ${totalSnapshots}`);
  console.log("===================\n");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
