import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ensureTable } from "./ensureTable.js";

// Accounts live in their own table so user data tables hold exactly what the
// handlers would write in AWS and can be copied or dropped independently.
export const LOCAL_AUTH_TABLE = process.env.LOCAL_AUTH_TABLE ?? "FinTrackLocalAuth";

const PROFILE_SK = "PROFILE";
const SESSION_SK = "SESSION";
const MIN_PASSWORD_LENGTH = 8;
const SCRYPT_KEY_LENGTH = 64;

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export class AuthError extends Error {
  constructor(
    readonly statusCode: 400 | 401 | 404,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

interface Profile {
  pk: string;
  sk: typeof PROFILE_SK;
  userId: string;
  email: string;
  tableName: string;
  passwordHash: string;
  createdAt: string;
}

interface Session {
  pk: string;
  sk: typeof SESSION_SK;
  userId: string;
  email: string;
  createdAt: string;
}

export interface ResolvedSession {
  userId: string;
  email: string;
  tableName: string;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const profileKey = (email: string) => `USER#${normalizeEmail(email)}`;
const sessionKey = (token: string) => `SESSION#${token}`;

// Created on first use rather than at import: migrate.ts imports this module
// for the key helpers and strips AWS_ENDPOINT_URL_* from the environment at
// its own top level, which must happen before any client reads them. This
// client is deliberately separate from utils/db.ts's docClient, which the
// table-rewrite middleware forces into a per-user table.
let clients: { raw: DynamoDBClient; doc: DynamoDBDocumentClient } | undefined;
function store() {
  if (!clients) {
    const raw = new DynamoDBClient({ maxAttempts: 1 });
    clients = { raw, doc: DynamoDBDocumentClient.from(raw) };
  }
  return clients;
}

export function ensureAuthTable(): Promise<void> {
  return ensureTable(store().raw, LOCAL_AUTH_TABLE);
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH);
  return `${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split("$");
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

function validate(email: string, password: string): string {
  if (!email.includes("@")) {
    throw new AuthError(400, "Email must contain @");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return normalizeEmail(email);
}

async function getProfile(email: string): Promise<Profile | undefined> {
  const result = await store().doc.send(
    new GetCommand({ TableName: LOCAL_AUTH_TABLE, Key: { pk: profileKey(email), sk: PROFILE_SK } }),
  );
  return result.Item as Profile | undefined;
}

async function countProfiles(): Promise<number> {
  let total = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await store().doc.send(
      new ScanCommand({
        TableName: LOCAL_AUTH_TABLE,
        Select: "COUNT",
        FilterExpression: "begins_with(pk, :user) AND sk = :profile",
        ExpressionAttributeValues: { ":user": "USER#", ":profile": PROFILE_SK },
        ExclusiveStartKey: startKey,
      }),
    );
    total += page.Count ?? 0;
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return total;
}

// The first account takes over the base table so data that predates accounts
// (or was copied in by migrate.ts with no LOCAL_USER) belongs to whoever signs
// in first; everyone after gets a table of their own.
async function createProfile(email: string, password: string): Promise<Profile> {
  const baseTable = process.env.TABLE_NAME;
  if (!baseTable) throw new Error("TABLE_NAME is required");
  const userId = randomUUID();
  const profile: Profile = {
    pk: profileKey(email),
    sk: PROFILE_SK,
    userId,
    email,
    tableName: (await countProfiles()) === 0 ? baseTable : `${baseTable}_${userId}`,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  await store().doc.send(
    new PutCommand({
      TableName: LOCAL_AUTH_TABLE,
      Item: profile,
      ConditionExpression: "attribute_not_exists(pk)",
    }),
  );
  await ensureTable(store().raw, profile.tableName);
  return profile;
}

async function createSession(profile: Profile): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const session: Session = {
    pk: sessionKey(token),
    sk: SESSION_SK,
    userId: profile.userId,
    email: profile.email,
    createdAt: new Date().toISOString(),
  };
  await store().doc.send(new PutCommand({ TableName: LOCAL_AUTH_TABLE, Item: session }));
  return token;
}

export async function signIn(
  rawEmail: string,
  password: string,
): Promise<{ token: string; userId: string; email: string }> {
  const email = validate(rawEmail, password);
  let profile = await getProfile(email);
  if (!profile) {
    try {
      profile = await createProfile(email, password);
    } catch (err) {
      // Two first sign-ins for the same address racing: the loser verifies
      // against the winner's profile like any other sign-in.
      if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
      profile = (await getProfile(email))!;
    }
  }
  if (!(await verifyPassword(password, profile.passwordHash))) {
    throw new AuthError(401, "Incorrect password");
  }
  const token = await createSession(profile);
  return { token, userId: profile.userId, email: profile.email };
}

export async function resolveSession(token: string): Promise<ResolvedSession | undefined> {
  const result = await store().doc.send(
    new GetCommand({ TableName: LOCAL_AUTH_TABLE, Key: { pk: sessionKey(token), sk: SESSION_SK } }),
  );
  const session = result.Item as Session | undefined;
  if (!session) return undefined;
  const profile = await getProfile(session.email);
  if (!profile) return undefined;
  return { userId: profile.userId, email: profile.email, tableName: profile.tableName };
}

export async function signOut(token: string): Promise<void> {
  await store().doc.send(
    new DeleteCommand({ TableName: LOCAL_AUTH_TABLE, Key: { pk: sessionKey(token), sk: SESSION_SK } }),
  );
}

export async function resetPassword(rawEmail: string, newPassword: string): Promise<void> {
  const email = validate(rawEmail, newPassword);
  try {
    await store().doc.send(
      new UpdateCommand({
        TableName: LOCAL_AUTH_TABLE,
        Key: { pk: profileKey(email), sk: PROFILE_SK },
        UpdateExpression: "SET passwordHash = :hash",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeValues: { ":hash": await hashPassword(newPassword) },
      }),
    );
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      throw new AuthError(404, `No local account for ${email}`);
    }
    throw err;
  }
}
