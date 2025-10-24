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
  sPath?: string | null;
  tid: string; // stringified neo4j id
  tlabel: string;
  tTitle?: string | null;
  tPath?: string | null;
  rel: string;
};

function parseFloatParam(value: string | null, name: string, min: number, max: number): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid '${name}' (expected number).`);
  }
  if (n < min || n > max) {
    throw new Error(`Invalid '${name}' (expected in [${min},${max}]).`);
  }
  return n;
}

function toNumber(x: unknown): number {
  if (typeof x === "number") return x;
  const i = x as Integer;
  if (i && typeof (i as any).toNumber === "function") return i.toNumber();
  throw new Error("Expected neo4j Integer or number");
}

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

  const mode = (searchParams.get("mode") || "").trim().toLowerCase();
  const isServerMode = mode === "server";

  // Server-mode branch: compute GDS metrics and coreScore
  if (isServerMode) {
    const seedsCsv = searchParams.get("seeds") ?? "";
    const seedStrs = seedsCsv
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (seedStrs.length === 0) {
      const res = NextResponse.json({ error: "Missing required 'seeds' (CSV of stringified node ids) for mode=server." }, { status: 400 });
      logInfo("http_request", {
        method: "GET",
        path: `${pathname}${req.nextUrl.search}`,
        status: 400,
        duration_ms: Date.now() - start,
      });
      return res;
    }

    let alpha: number | undefined;
    let beta: number | undefined;
    let gamma: number | undefined;
    let lambda: number | undefined;
    let exponent: number | undefined;
    try {
      alpha = parseFloatParam(searchParams.get("alpha"), "alpha", 0, 1);
      beta = parseFloatParam(searchParams.get("beta"), "beta", 0, 1);
      gamma = parseFloatParam(searchParams.get("gamma"), "gamma", 0, 1);
      lambda = parseFloatParam(searchParams.get("lambda"), "lambda", 0, 1);
      const expRaw = searchParams.get("exponent");
      if (expRaw != null) {
        const e = Number(expRaw);
        if (!Number.isFinite(e) || e <= 0) throw new Error("Invalid 'exponent' (expected > 0).");
        exponent = e;
        // Note: exponent is intentionally parsed here but not used on the server.
        // It is applied on the client for visual mapping (size/label scaling).
      }
    } catch (e) {
      const res = NextResponse.json({ error: (e as Error).message }, { status: 400 });
      logInfo("http_request", {
        method: "GET",
        path: `${pathname}${req.nextUrl.search}`,
        status: 400,
        duration_ms: Date.now() - start,
      });
      return res;
    }
    const weightsProvided = [alpha, beta, gamma].filter((x) => typeof x === "number").length;
    if (weightsProvided === 0) {
      const res = NextResponse.json({ error: "At least one of alpha,beta,gamma must be provided for coreScore computation." }, { status: 400 });
      logInfo("http_request", {
        method: "GET",
        path: `${pathname}${req.nextUrl.search}`,
        status: 400,
        duration_ms: Date.now() - start,
      });
      return res;
    }
    if ((gamma ?? 0) > 0 && typeof lambda !== "number") {
      const res = NextResponse.json({ error: "Parameter 'lambda' is required when gamma > 0." }, { status: 400 });
      logInfo("http_request", {
        method: "GET",
        path: `${pathname}${req.nextUrl.search}`,
        status: 400,
        duration_ms: Date.now() - start,
      });
      return res;
    }

    let driver: Driver;
    let database: string | undefined;
    try {
      ({ driver, database } = getDriver());
    } catch (_e) {
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

    const withTypeFilter = rels.length > 0;
    const graphName = `core_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const nodeQuery = [
      "WITH $collection AS collection, $rels AS rels, $limit AS limit",
      "MATCH ()-[r]->()",
      "WHERE r.collection = collection AND (size(rels) = 0 OR type(r) IN rels)",
      "WITH r LIMIT limit",
      "MATCH (s)-[r]->(t)",
      "WITH collect(s) + collect(t) AS nds",
      "UNWIND nds AS n",
      "RETURN DISTINCT id(n) AS id, labels(n) AS labels",
    ].join("\n");
    const relationshipQuery = [
      "WITH $collection AS collection, $rels AS rels, $limit AS limit",
      "MATCH ()-[r]->()",
      "WHERE r.collection = collection AND (size(rels) = 0 OR type(r) IN rels)",
      "WITH r LIMIT limit",
      "MATCH (s)-[r]->(t)",
      "RETURN id(s) AS source, id(t) AS target, type(r) AS type",
    ].join("\n");
    const resultRowsCypher = (withTypeFilter
      ? [
          "MATCH ()-[r]->()",
          "WHERE r.collection = $collection AND type(r) IN $rels",
          "WITH r LIMIT $limit",
          "MATCH (s)-[r]->(t)",
          "RETURN toString(id(s)) AS sid, labels(s)[0] AS slabel, coalesce(s.name,s.title,s.qualified_name) AS sTitle, s.path AS sPath,",
          "       toString(id(t)) AS tid, labels(t)[0] AS tlabel, coalesce(t.name,t.title,t.qualified_name) AS tTitle, t.path AS tPath,",
          "       type(r) AS rel",
        ]
      : [
          "MATCH ()-[r]->()",
          "WHERE r.collection = $collection",
          "WITH r LIMIT $limit",
          "MATCH (s)-[r]->(t)",
          "RETURN toString(id(s)) AS sid, labels(s)[0] AS slabel, coalesce(s.name,s.title,s.qualified_name) AS sTitle, s.path AS sPath,",
          "       toString(id(t)) AS tid, labels(t)[0] AS tlabel, coalesce(t.name,t.title,t.qualified_name) AS tTitle, t.path AS tPath,",
          "       type(r) AS rel",
        ]).join("\n");

    let graphCreated = false;
    const t0 = Date.now();
    try {
      logInfo("api_graph_core_start", {
        collection,
        rels: withTypeFilter ? rels : "(all)",
        limit,
        mode: "server",
        seed_count: seedStrs.length,
      });

      // Explicit GDS availability check: return 501 if GDS is not installed/available
      try {
        await session.run("CALL gds.version() YIELD version RETURN version");
      } catch (e) {
        logError("gds_unavailable", {
          mode: "server",
          collection,
          rels: withTypeFilter ? rels : "(all)",
          limit,
          error: String(e),
        });
        const res = NextResponse.json(
          { error: "Server-mode requires Neo4j GDS; not available. mode=server is not supported on this server." },
          { status: 501 }
        );
        logInfo("http_request", {
          method: "GET",
          path: `${pathname}${req.nextUrl.search}`,
          status: 501,
          duration_ms: Date.now() - start,
        });
        return res;
      }

      // Project subgraph
      const projectRes = await session.run(
        "CALL gds.graph.project.cypher($name, $nodeQuery, $relQuery, { parameters: { collection: $collection, rels: $rels, limit: $limit } }) YIELD graphName, nodeCount, relationshipCount RETURN graphName, nodeCount, relationshipCount",
        {
          name: graphName,
          nodeQuery,
          relQuery: relationshipQuery,
          collection,
          rels,
          limit: neo4j.int(limit),
        }
      );
      if (projectRes.records.length === 0) {
        throw new Error("gds.graph.project.cypher returned no records");
      }
      const projNodeCount = toNumber(projectRes.records[0].get("nodeCount"));
      const projRelCount = toNumber(projectRes.records[0].get("relationshipCount"));
      graphCreated = true;
      logInfo("gds_graph_project_ok", {
        graph: graphName,
        nodeCount: projNodeCount,
        relationshipCount: projRelCount,
        duration_ms: Date.now() - t0,
      });

      // Fetch nodes/links for response and to intersect seeds
      const baseRows = await session.run(resultRowsCypher, {
        collection,
        rels: withTypeFilter ? rels : undefined,
        limit: neo4j.int(limit),
      });
      const nodesMap = new Map<string, { id: string; label: string; title?: string; path?: string }>();
      const links: { source: string; target: string; type: string }[] = [];
      for (const record of baseRows.records) {
        const row: GraphRow = {
          sid: record.get("sid") as string,
          slabel: record.get("slabel") as string,
          sTitle: (record.get("sTitle") as string | null) ?? null,
          sPath: (record.get("sPath") as string | null) ?? null,
          tid: record.get("tid") as string,
          tlabel: record.get("tlabel") as string,
          tTitle: (record.get("tTitle") as string | null) ?? null,
          tPath: (record.get("tPath") as string | null) ?? null,
          rel: record.get("rel") as string,
        };
        if (!nodesMap.has(row.sid)) {
          nodesMap.set(row.sid, { id: row.sid, label: row.slabel, title: row.sTitle ?? undefined, path: row.sPath ?? undefined });
        }
        if (!nodesMap.has(row.tid)) {
          nodesMap.set(row.tid, { id: row.tid, label: row.tlabel, title: row.tTitle ?? undefined, path: row.tPath ?? undefined });
        }
        links.push({ source: row.sid, target: row.tid, type: row.rel });
      }
      const nodes = Array.from(nodesMap.values());
      // Intersect seeds with nodes present in subgraph
      const seedIds: number[] = seedStrs
        .filter((s) => nodesMap.has(s))
        .map((s) => {
          const n = Number(s);
          if (!Number.isFinite(n)) {
            throw new Error(`Seed '${s}' is not a valid numeric string id`);
          }
          return n;
        });
      if (seedIds.length === 0) {
        const res = NextResponse.json({ error: "None of the provided seeds are present in the selected subgraph." }, { status: 400 });
        logInfo("http_request", {
          method: "GET",
          path: `${pathname}${req.nextUrl.search}`,
          status: 400,
          duration_ms: Date.now() - start,
        });
        return res;
      }

      // PPR
      const tPpr0 = Date.now();
      const pprRes = await session.run(
        "CALL gds.pageRank.stream($gname, { sourceNodes: $sourceNodes, maxIterations: 50, dampingFactor: 0.85 }) YIELD nodeId, score RETURN nodeId, score",
        { gname: graphName, sourceNodes: seedIds }
      );
      const pprMap = new Map<number, number>();
      for (const rec of pprRes.records) {
        const nid = toNumber(rec.get("nodeId"));
        const score = Number(rec.get("score"));
        pprMap.set(nid, score);
      }
      logInfo("gds_ppr_done", { count: pprMap.size, duration_ms: Date.now() - tPpr0 });

      // Degree
      const tDeg0 = Date.now();
      const degRes = await session.run("CALL gds.degree.stream($gname) YIELD nodeId, score RETURN nodeId, score", { gname: graphName });
      const degMap = new Map<number, number>();
      for (const rec of degRes.records) {
        const nid = toNumber(rec.get("nodeId"));
        const score = Number(rec.get("score"));
        degMap.set(nid, score);
      }
      logInfo("gds_degree_done", { count: degMap.size, duration_ms: Date.now() - tDeg0 });

      // Distances via BFS (requires GDS beta bfs)
      const tDist0 = Date.now();
      let distMap = new Map<number, number>();
      try {
        const distRes = await session.run(
          "CALL gds.beta.bfs.stream($gname, { startNodes: $startNodes, maxDepth: 100 }) YIELD nodeId, depth RETURN nodeId, depth",
          { gname: graphName, startNodes: seedIds }
        );
        for (const rec of distRes.records) {
          const nid = toNumber(rec.get("nodeId"));
          const depth = toNumber(rec.get("depth"));
          const prev = distMap.get(nid);
          if (prev === undefined || depth < prev) {
            distMap.set(nid, depth);
          }
        }
      } catch (e) {
        logError("gds_unavailable", {
          mode: "server",
          collection,
          rels: withTypeFilter ? rels : "(all)",
          limit,
          error: String(e),
        });
        const res = NextResponse.json(
          { error: "Server-mode requires Neo4j GDS; not available. mode=server is not supported on this server." },
          { status: 501 }
        );
        logInfo("http_request", {
          method: "GET",
          path: `${pathname}${req.nextUrl.search}`,
          status: 501,
          duration_ms: Date.now() - start,
        });
        return res;
      }
      logInfo("gds_dist_done", { count: distMap.size, duration_ms: Date.now() - tDist0 });

      // Normalize helpers
      function normalize(values: number[]): (val: number) => number {
        if (values.length === 0) return () => 0;
        let min = Infinity;
        let max = -Infinity;
        for (const v of values) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const range = max - min;
        if (range === 0) {
          return () => 0;
        }
        return (val: number) => (val - min) / range;
      }

      // Build id maps for node id (number) from string
      const nodeIdNumSet = new Set<number>();
      for (const n of nodes) {
        const num = Number(n.id);
        if (Number.isFinite(num)) nodeIdNumSet.add(num);
      }

      const pprVals: number[] = [];
      const degVals: number[] = [];
      for (const nid of nodeIdNumSet) {
        if (pprMap.has(nid)) pprVals.push(pprMap.get(nid)!);
        else pprVals.push(0);
        if (degMap.has(nid)) degVals.push(degMap.get(nid)!);
        else degVals.push(0);
      }
      const normPpr = normalize(pprVals);
      const normDeg = normalize(degVals);

      // Prepare output with metrics
      const lambdaVal = typeof lambda === "number" ? lambda : 0;
      const alphaVal = typeof alpha === "number" ? alpha : 0;
      const betaVal = typeof beta === "number" ? beta : 0;
      const gammaVal = typeof gamma === "number" ? gamma : 0;

      const nodesOut = nodes.map((n) => {
        const nid = Number(n.id);
        const pprRaw = pprMap.get(nid) ?? 0;
        const degRaw = degMap.get(nid) ?? 0;
        const dist = distMap.has(nid) ? distMap.get(nid)! : Infinity;
        const pprN = normPpr(pprRaw);
        const degN = normDeg(degRaw);
        const distTerm = Number.isFinite(dist) ? Math.exp(-lambdaVal * dist) : 0;
        const coreScore = alphaVal * pprN + betaVal * degN + gammaVal * distTerm;
        return {
          id: n.id,
          label: n.label,
          title: n.title,
          path: n.path,
          ppr: pprRaw,
          deg: degRaw,
          dist: Number.isFinite(dist) ? dist : null,
          coreScore,
        };
      });

      const res = NextResponse.json({ nodes: nodesOut, links });
      logInfo("api_graph_core_respond", {
        nodes: nodesOut.length,
        links: links.length,
        duration_ms: Date.now() - start,
        mode: "server",
      });
      return res;
    } catch (err) {
      const errStr = String(err);
      if (/There is no procedure with the name gds/i.test(errStr)) {
        logError("gds_unavailable", {
          mode: "server",
          collection,
          limit,
          rels: withTypeFilter ? rels : "(all)",
          error: errStr,
        });
        const res = NextResponse.json(
          { error: "Server-mode requires Neo4j GDS; not available. mode=server is not supported on this server." },
          { status: 501 }
        );
        logInfo("http_request", {
          method: "GET",
          path: `${pathname}${req.nextUrl.search}`,
          status: 501,
          duration_ms: Date.now() - start,
        });
        return res;
      }
      logError("api_graph_core_failed", {
        error: String(err),
        collection,
        limit,
        rels: withTypeFilter ? rels : "(all)",
        mode: "server",
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
      if (graphCreated) {
        try {
          await session.run("CALL gds.graph.drop($name)", { name: graphName });
        } catch (e) {
          logError("gds_graph_drop_failed", { graph: graphName, error: String(e) });
        }
      }
      await session.close();
    }
  }

  const withTypeFilter = rels.length > 0;
  const cypher = withTypeFilter
    ? [
        "MATCH ()-[r]->()",
        "WHERE r.collection = $collection AND type(r) IN $rels",
        "WITH r LIMIT $limit",
        "MATCH (s)-[r]->(t)",
        "RETURN toString(id(s)) AS sid, labels(s)[0] AS slabel, coalesce(s.name,s.title,s.qualified_name) AS sTitle, s.path AS sPath,",
        "       toString(id(t)) AS tid, labels(t)[0] AS tlabel, coalesce(t.name,t.title,t.qualified_name) AS tTitle, t.path AS tPath,",
        "       type(r) AS rel",
      ].join("\n")
    : [
        "MATCH ()-[r]->()",
        "WHERE r.collection = $collection",
        "WITH r LIMIT $limit",
        "MATCH (s)-[r]->(t)",
        "RETURN toString(id(s)) AS sid, labels(s)[0] AS slabel, coalesce(s.name,s.title,s.qualified_name) AS sTitle, s.path AS sPath,",
        "       toString(id(t)) AS tid, labels(t)[0] AS tlabel, coalesce(t.name,t.title,t.qualified_name) AS tTitle, t.path AS tPath,",
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

    const nodesMap = new Map<string, { id: string; label: string; title?: string; path?: string }>();
    const links: { source: string; target: string; type: string }[] = [];

    for (const record of result.records) {
      const row: GraphRow = {
        sid: record.get("sid") as string,
        slabel: record.get("slabel") as string,
        sTitle: (record.get("sTitle") as string | null) ?? null,
        sPath: (record.get("sPath") as string | null) ?? null,
        tid: record.get("tid") as string,
        tlabel: record.get("tlabel") as string,
        tTitle: (record.get("tTitle") as string | null) ?? null,
        tPath: (record.get("tPath") as string | null) ?? null,
        rel: record.get("rel") as string,
      };
      if (!nodesMap.has(row.sid)) {
        nodesMap.set(row.sid, { id: row.sid, label: row.slabel, title: row.sTitle ?? undefined, path: row.sPath ?? undefined });
      }
      if (!nodesMap.has(row.tid)) {
        nodesMap.set(row.tid, { id: row.tid, label: row.tlabel, title: row.tTitle ?? undefined, path: row.tPath ?? undefined });
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


