import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { docClient, TABLE_NAME } from "../utils/db.js";
import {
  AuthError,
  ensureAuthTable,
  resetPassword,
  resolveSession,
  signIn,
  signOut,
  type ResolvedSession,
} from "./auth.js";
import { als, installTableRewrite } from "./tableContext.js";

const PORT = Number(process.env.PORT ?? 3000);
const HANDLERS_DIR = path.join(__dirname, "..", "handlers");
const DB_MODULE = path.join(__dirname, "..", "utils", "db.ts");

// response.ts sends Access-Control-Allow-Headers: * but the fetch spec does not
// treat the wildcard as covering Authorization, so preflight must name it.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

interface Route {
  routeKey: string;
  method: string;
  segments: string[];
  paramCount: number;
  handler: APIGatewayProxyHandlerV2;
}

// The route table is scraped from the handler sources rather than declared here
// so upstream can add routes without this file needing to know. That only works
// while handlers dispatch on `routeKey === "<literal>"`; if the style changes the
// scrape finds nothing and we exit rather than 404 every request.
async function loadRoutes(): Promise<Route[]> {
  const routes: Route[] = [];
  const owners = new Map<string, string>();
  const files = readdirSync(HANDLERS_DIR).filter((f) => f.endsWith(".ts")).sort();

  for (const file of files) {
    const full = path.join(HANDLERS_DIR, file);
    const source = readFileSync(full, "utf8");
    const keys = [...source.matchAll(/routeKey === "([A-Z]+ \/[^"]*)"/g)].map((m) => m[1]);
    if (keys.length === 0) continue;

    const mod: { handler?: unknown } = await import(pathToFileURL(full).href);
    if (typeof mod.handler !== "function") {
      throw new Error(`${file} matches route keys but exports no handler function`);
    }
    const handler = mod.handler as APIGatewayProxyHandlerV2;

    for (const routeKey of keys) {
      const owner = owners.get(routeKey);
      if (owner) {
        console.warn(`Route ${routeKey} appears in both ${owner} and ${file}; using ${owner}`);
        continue;
      }
      owners.set(routeKey, file);
      const [method, template] = routeKey.split(" ", 2);
      const segments = template.split("/").filter(Boolean);
      routes.push({
        routeKey,
        method,
        segments,
        paramCount: segments.filter(isParam).length,
        handler,
      });
      console.log(`${routeKey.padEnd(40)} -> ${file}`);
    }
  }

  if (routes.length === 0) {
    throw new Error(`No routeKey literals found in ${HANDLERS_DIR}`);
  }
  // Fewer parameters first so "GET /snapshots" beats "GET /{id}"-style templates.
  return routes.sort((a, b) => a.paramCount - b.paramCount);
}

const isParam = (segment: string) => segment.startsWith("{") && segment.endsWith("}");

function matchRoute(
  routes: Route[],
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | undefined {
  const segments = pathname.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.method !== method || route.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < segments.length; i++) {
      const expected = route.segments[i];
      if (isParam(expected)) {
        params[expected.slice(1, -1)] = decodeURIComponent(segments[i]);
      } else if (expected !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return undefined;
}

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      resolve(body.length > 0 ? body : undefined);
    });
    req.on("error", reject);
  });
}

function buildEvent(
  req: IncomingMessage,
  method: string,
  url: URL,
  routeKey: string,
  params: Record<string, string>,
  body: string | undefined,
  session: ResolvedSession,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(",") : value;
  }
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, name) => {
    query[name] = value;
  });
  const now = Date.now();

  return {
    version: "2.0",
    routeKey,
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers,
    queryStringParameters: Object.keys(query).length > 0 ? query : undefined,
    pathParameters: Object.keys(params).length > 0 ? params : undefined,
    body,
    isBase64Encoded: false,
    requestContext: {
      accountId: "local",
      apiId: "local",
      // Shaped like API Gateway's JWT authorizer output so a handler that starts
      // reading the caller's identity works unchanged here.
      authorizer: {
        principalId: session.userId,
        integrationLatency: 0,
        jwt: {
          claims: { sub: session.userId, email: session.email },
          scopes: [],
        },
      },
      domainName: `localhost:${PORT}`,
      domainPrefix: "localhost",
      http: {
        method,
        path: url.pathname,
        protocol: "HTTP/1.1",
        sourceIp: req.socket.remoteAddress ?? "127.0.0.1",
        userAgent: headers["user-agent"] ?? "",
      },
      requestId: randomUUID(),
      routeKey,
      stage: "$default",
      time: new Date(now).toISOString(),
      timeEpoch: now,
    },
  };
}

function send(
  res: ServerResponse,
  statusCode: number,
  headers: Record<string, string | number | boolean> | undefined,
  body: string | undefined,
): void {
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) merged[name] = String(value);
  // Server CORS headers win so every response, including handler output and
  // our own 404/500, is consistent with what the preflight promised.
  res.writeHead(statusCode, { ...merged, ...CORS_HEADERS });
  res.end(body);
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  send(res, statusCode, { "Content-Type": "application/json" }, JSON.stringify(data));
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(" ", 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (!body) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new AuthError(400, "Body must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AuthError(400, "Body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

const asString = (value: unknown) => (typeof value === "string" ? value : "");

// Stands in for Cognito. Only sign-in creates accounts, so the frontend's
// existing login form is the whole onboarding flow.
async function handleAuth(
  method: string,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (method === "POST" && pathname === "/local/auth/sign-in") {
    const body = await readJsonBody(req);
    const result = await signIn(asString(body.email), asString(body.password));
    sendJson(res, 200, { token: result.token, userId: result.userId, username: result.email });
    return true;
  }
  if (method === "GET" && pathname === "/local/auth/session") {
    const token = bearerToken(req);
    const session = token ? await resolveSession(token) : undefined;
    if (!session) sendJson(res, 401, { message: "Unauthorized" });
    else sendJson(res, 200, { userId: session.userId, username: session.email });
    return true;
  }
  if (method === "POST" && pathname === "/local/auth/sign-out") {
    const token = bearerToken(req);
    if (token) await signOut(token);
    send(res, 204, undefined, undefined);
    return true;
  }
  if (method === "POST" && pathname === "/local/auth/reset-password") {
    const body = await readJsonBody(req);
    // The confirmation code is accepted but never checked: nothing sends email
    // locally, so there is no code to compare against.
    await resetPassword(asString(body.email), asString(body.newPassword));
    send(res, 204, undefined, undefined);
    return true;
  }
  return false;
}

async function handleRequest(routes: Route[], req: IncomingMessage, res: ServerResponse) {
  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // Preflight carries no Authorization header, so it must be answered before
  // the session check or the browser never gets to send the real request.
  if (method === "OPTIONS") {
    send(res, 204, undefined, undefined);
    return;
  }

  try {
    if (await handleAuth(method, url.pathname, req, res)) return;
  } catch (err) {
    if (err instanceof AuthError) {
      sendJson(res, err.statusCode, { message: err.message });
      return;
    }
    throw err;
  }

  const match = matchRoute(routes, method, url.pathname);
  if (!match) {
    sendJson(res, 404, { message: `No route for ${method} ${url.pathname}` });
    return;
  }

  const token = bearerToken(req);
  const session = token ? await resolveSession(token) : undefined;
  if (!session) {
    sendJson(res, 401, { message: "Unauthorized" });
    return;
  }

  const body = await readBody(req);
  const event = buildEvent(req, method, url, match.route.routeKey, match.params, body, session);
  // Handlers never read the Lambda context, so an empty one is enough.
  const result = await als.run({ tableName: session.tableName }, () =>
    match.route.handler(event, {} as Context, () => undefined),
  );

  if (result === undefined) {
    sendJson(res, 500, { message: "Handler returned nothing" });
  } else if (typeof result === "string") {
    send(res, 200, { "Content-Type": "application/json" }, result);
  } else {
    const structured = result as APIGatewayProxyStructuredResultV2;
    send(res, structured.statusCode ?? 200, structured.headers, structured.body);
  }
}

// The handlers reach utils/db.ts through tsx's ESM loader (loadRoutes uses a
// file URL import) while this file reaches it through a static import. If the
// two ever resolved to different module instances the middleware would be on a
// client the handlers never use and every request would hit the shared table,
// so refuse to start rather than trust that they agree.
async function assertSingleDocClient(): Promise<void> {
  const viaEsm: { docClient?: unknown } = await import(pathToFileURL(DB_MODULE).href);
  if (viaEsm.docClient !== docClient) {
    throw new Error("utils/db.ts loaded twice; table rewrite would not apply to handlers");
  }
}

async function main() {
  if (!TABLE_NAME) throw new Error("TABLE_NAME is required");

  installTableRewrite(docClient, TABLE_NAME);
  await assertSingleDocClient();
  await ensureAuthTable();
  const routes = await loadRoutes();

  createServer((req, res) => {
    handleRequest(routes, req, res).catch((err: unknown) => {
      console.error(`${req.method} ${req.url} failed:`, err);
      if (!res.headersSent) sendJson(res, 500, { message: "Internal server error" });
      else res.end();
    });
  }).listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT} (first account owns table ${TABLE_NAME})`);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
