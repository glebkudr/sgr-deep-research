import { NextRequest, NextResponse } from "next/server";
import neo4j, { Driver, Session, Integer } from "neo4j-driver";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function logInfo(event: string, data: JsonRecord = {}): void {
  // Structured JSON logging to stdout
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: nowIso(), level: "info", event, ...data }));
}

function logError(event: string, data: JsonRecord = {}): void {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ ts: nowIso(), level: "error", event, ...data }));
}

let sharedDriver: Driver | null = null;
function getDriver(): { driver: Driver; database: string | undefined } {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USERNAME;
  const pass = process.env.NEO4J_PASSWORD;
  const database = process.env.NEO4J_DATABASE || undefined;
  if (!uri || !uri.trim()) {
    logError("missing_env", { name: "NEO4J_URI" });
    throw new Error("Missing required env var: NEO4J_URI");
  }
  if (!user || !user.trim()) {
    logError("missing_env", { name: "NEO4J_USERNAME" });
    throw new Error("Missing required env var: NEO4J_USERNAME");
  }
  if (!pass || !pass.trim()) {
    logError("missing_env", { name: "NEO4J_PASSWORD" });
    throw new Error("Missing required env var: NEO4J_PASSWORD");
  }
  if (!sharedDriver) {
    try {
      sharedDriver = neo4j.driver(uri, neo4j.auth.basic(user, pass));
    } catch (e) {
      logError("neo4j_driver_init_failed", { error: String(e) });
      throw e as Error;
    }
  }
  return { driver: sharedDriver, database };
}

type GraphRow = {
  sid: string; // stringified neo4j id
  slabel: string;
  sTitle?: string | null;
  tid: string; // stringified neo4j id
  tlabel: string;
  tTitle?: string | null;
  rel: string;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();
  const { pathname, searchParams } = req.nextUrl;

  const collection = searchParams.get("collection")?.trim();
  if (!collection) {
    const res = NextResponse.json({ error: "Query param 'collection' is required." }, { status: 400 });
    logInfo("http_request", {
      method: "GET",
      path: `${pathname}${req.nextUrl.search}`,
      status: 400,
      duration_ms: Date.now() - start,
    });
    return res;
  }

  const limitRaw = searchParams.get("limit")?.trim();
  const limit = limitRaw ? Number(limitRaw) : 2000;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > 10000) {
    const res = NextResponse.json({ error: "Invalid 'limit' (expected integer in [1,10000])." }, { status: 400 });
    logInfo("http_request", {
      method: "GET",
      path: `${pathname}${req.nextUrl.search}`,
      status: 400,
      duration_ms: Date.now() - start,
    });
    return res;
  }

  const relsCsv = searchParams.get("rels") ?? "";
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
        "RETURN toString(id(s)) AS sid, labels(s)[0] AS slabel, coalesce(s.name,s.title,s.qualified_name) AS sTitle,",
        "       toString(id(t)) AS tid, labels(t)[0] AS tlabel, coalesce(t.name,t.title,t.qualified_name) AS tTitle,",
        "       type(r) AS rel",
      ].join("\n")
    : [
        "MATCH ()-[r]->()",
        "WHERE r.collection = $collection",
        "WITH r LIMIT $limit",
        "MATCH (s)-[r]->(t)",
        "RETURN toString(id(s)) AS sid, labels(s)[0] AS slabel, coalesce(s.name,s.title,s.qualified_name) AS sTitle,",
        "       toString(id(t)) AS tid, labels(t)[0] AS tlabel, coalesce(t.name,t.title,t.qualified_name) AS tTitle,",
        "       type(r) AS rel",
      ].join("\n");

  let driver: Driver;
  let database: string | undefined;
  try {
    ({ driver, database } = getDriver());
  } catch (e) {
    const res = NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    logInfo("http_request", {
      method: "GET",
      path: `${pathname}${req.nextUrl.search}`,
      status: 500,
      duration_ms: Date.now() - start,
    });
    return res;
  }

  const session: Session = driver.session({
    defaultAccessMode: neo4j.session.READ,
    database,
  });

  try {
    const result = await session.run(cypher, {
      collection,
      limit: neo4j.int(limit),
      rels: withTypeFilter ? rels : undefined,
    });

    const nodesMap = new Map<string, { id: string; label: string; title?: string }>();
    const links: { source: string; target: string; type: string }[] = [];

    for (const record of result.records) {
      const row: GraphRow = {
        sid: record.get("sid") as string,
        slabel: record.get("slabel") as string,
        sTitle: (record.get("sTitle") as string | null) ?? null,
        tid: record.get("tid") as string,
        tlabel: record.get("tlabel") as string,
        tTitle: (record.get("tTitle") as string | null) ?? null,
        rel: record.get("rel") as string,
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
    const res = NextResponse.json({ nodes, links });
    logInfo("graph_counts", { nodes: nodes.length, links: links.length });
    logInfo("http_request", {
      method: "GET",
      path: `${pathname}${req.nextUrl.search}`,
      status: 200,
      duration_ms: Date.now() - start,
    });
    return res;
  } catch (err) {
    logError("api_graph_failed", {
      error: String(err),
      collection,
      limit,
      rels: withTypeFilter ? rels : "(all)",
    });
    const res = NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    logInfo("http_request", {
      method: "GET",
      path: `${pathname}${req.nextUrl.search}`,
      status: 500,
      duration_ms: Date.now() - start,
    });
    return res;
  } finally {
    await session.close();
  }
}


