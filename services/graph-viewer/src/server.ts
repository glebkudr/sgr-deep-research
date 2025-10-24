import express, { NextFunction, Request, Response } from "express";
import path from "path";
import neo4j, { Driver, Integer, Session } from "neo4j-driver";

type JsonRecord = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function logInfo(event: string, data: JsonRecord = {}): void {
  // Structured JSON logging
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: nowIso(), level: "info", event, ...data }));
}

function logError(event: string, data: JsonRecord = {}): void {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ ts: nowIso(), level: "error", event, ...data }));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const app = express();

// Basic request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    logInfo("http_request", {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - start
    });
  });
  next();
});

// Static UI
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Neo4j driver init (fail fast on required env)
const NEO4J_URI = requireEnv("NEO4J_URI");
const NEO4J_USER_RO = requireEnv("NEO4J_USER_RO");
const NEO4J_PASS_RO = requireEnv("NEO4J_PASS_RO");
const NEO4J_DATABASE = process.env.NEO4J_DATABASE; // optional

let driver: Driver;
try {
  driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER_RO, NEO4J_PASS_RO));
} catch (e) {
  logError("neo4j_driver_init_failed", { error: String(e) });
  // Hard fail to avoid running in partial state
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

type GraphRow = {
  sid: number;
  slabel: string;
  sTitle?: string | null;
  tid: number;
  tlabel: string;
  tTitle?: string | null;
  rel: string;
};

app.get("/api/graph", async (req: Request, res: Response, next: NextFunction) => {
  const collection = (req.query.collection as string | undefined)?.trim();
  if (!collection) {
    res.status(400).json({ error: "Query param 'collection' is required." });
    return;
  }

  const limitRaw = (req.query.limit as string | undefined)?.trim();
  const limit = limitRaw ? Number(limitRaw) : 2000;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > 10000) {
    res.status(400).json({ error: "Invalid 'limit' (expected integer in [1,10000])." });
    return;
  }

  const relsCsv = (req.query.rels as string | undefined) ?? "";
  const rels = relsCsv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.toUpperCase());

  const withTypeFilter = rels.length > 0;
  const cypher = withTypeFilter
    ? [
        "MATCH ()-[r]->()",
        "WHERE r.collection = $collection AND type(r) IN $rels",
        "WITH r LIMIT $limit",
        "MATCH (s)-[r]->(t)",
        "RETURN id(s) AS sid, labels(s)[0] AS slabel, coalesce(s.name,s.title,s.qualified_name) AS sTitle,",
        "       id(t) AS tid, labels(t)[0] AS tlabel, coalesce(t.name,t.title,t.qualified_name) AS tTitle,",
        "       type(r) AS rel"
      ].join("\n")
    : [
        "MATCH ()-[r]->()",
        "WHERE r.collection = $collection",
        "WITH r LIMIT $limit",
        "MATCH (s)-[r]->(t)",
        "RETURN id(s) AS sid, labels(s)[0] AS slabel, coalesce(s.name,s.title,s.qualified_name) AS sTitle,",
        "       id(t) AS tid, labels(t)[0] AS tlabel, coalesce(t.name,t.title,t.qualified_name) AS tTitle,",
        "       type(r) AS rel"
      ].join("\n");

  const session: Session = driver.session({
    defaultAccessMode: neo4j.session.READ,
    database: NEO4J_DATABASE || undefined
  });

  try {
    const result = await session.run(cypher, {
      collection,
      limit: neo4j.int(limit),
      rels: withTypeFilter ? rels : undefined
    });

    const nodesMap = new Map<number, { id: number; label: string; title?: string }>();
    const links: { source: number; target: number; type: string }[] = [];

    for (const record of result.records) {
      const row: GraphRow = {
        sid: (record.get("sid") as Integer).toNumber(),
        slabel: record.get("slabel"),
        sTitle: record.get("sTitle"),
        tid: (record.get("tid") as Integer).toNumber(),
        tlabel: record.get("tlabel"),
        tTitle: record.get("tTitle"),
        rel: record.get("rel")
      };
      if (!nodesMap.has(row.sid)) {
        nodesMap.set(row.sid, { id: row.sid, label: row.slabel, title: row.sTitle ?? undefined });
      }
      if (!nodesMap.has(row.tid)) {
        nodesMap.set(row.tid, { id: row.tid, label: row.tlabel, title: row.tTitle ?? undefined });
      }
      links.push({ source: row.sid, target: row.tid, type: row.rel });
    }

    const nodes = Array.from(nodesMap.values());
    res.json({ nodes, links });
  } catch (err) {
    logError("api_graph_failed", {
      error: String(err),
      collection,
      limit,
      rels: withTypeFilter ? rels : "(all)"
    });
    next(err);
  } finally {
    await session.close();
  }
});

// Error handler — structured error response
// Note: Do not swallow errors; respond with 500 and log.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logError("unhandled_error", { error: String(err) });
  res.status(500).json({ error: "Internal Server Error" });
});

process.on("unhandledRejection", (reason) => {
  logError("unhandled_rejection", { reason: String(reason) });
  // eslint-disable-next-line no-process-exit
  process.exit(1);
});

function resolvePort(): number {
  const raw = process.env.PORT;
  if (!raw || raw.trim().length === 0) {
    return 8081;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT value: ${raw}`);
  }
  return parsed;
}

function resolveHost(): string {
  const override = process.env.HOST;
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  const devFlagRaw = process.env.DEV;
  const devEnabled = Boolean(devFlagRaw && devFlagRaw.trim().toLowerCase() === "true");
  if (devEnabled) {
    return "0.0.0.0";
  }
  return "127.0.0.1";
}

let PORT: number;
let HOST: string;
try {
  PORT = resolvePort();
  HOST = resolveHost();
} catch (err) {
  logError("config_invalid", { error: String(err) });
  throw err;
}

app.listen(PORT, HOST, () => {
  logInfo("server_started", { host: HOST, port: PORT });
});
