/**
export type Node = { id: string; label?: string; title?: string; path?: string };
export type Link = { source: string; target: string; type?: string };
export type GraphData = { nodes: Node[]; links: Link[] };

export type DecoratedNode = Node & {
  _ppr: number;
  _deg: number;
  _dist: number | null;
  _score: number;
  _size: number;
  _labelSize: number;
};
export type DecoratedLink = Link & { _score: number };
export type DecoratedGraphData = { nodes: DecoratedNode[]; links: DecoratedLink[] };

type Options = {
  seeds: Set<string>;
  alpha: number;
  beta: number;
  gamma: number;
  lambda: number;
  exponent: number;
  sizeMin: number;
  sizeMax: number;
  labelMin: number;
  labelMax: number;
  iterations: number; // 10..30
  dampingFactor: number; // (0,1)
};

function nowIso(): string {
  return new Date().toISOString();
}

function validateOptions(data: GraphData, options: Options): void {
  if (!options.seeds || options.seeds.size === 0) {
    throw new Error("Client-mode requires non-empty seeds.");
  }
  const in01 = (x: number) => x >= 0 && x <= 1;
  if (!in01(options.alpha)) throw new Error("Invalid alpha: expected in [0,1].");
  if (!in01(options.beta)) throw new Error("Invalid beta: expected in [0,1].");
  if (!in01(options.gamma)) throw new Error("Invalid gamma: expected in [0,1].");
  if (!in01(options.lambda)) throw new Error("Invalid lambda: expected in [0,1].");
  if (!(options.exponent > 0)) throw new Error("Invalid exponent: expected > 0.");
  if (!(Number.isInteger(options.iterations) && options.iterations >= 10 && options.iterations <= 30)) {
    throw new Error("Invalid iterations: expected integer in [10,30].");
  }
  if (!(options.dampingFactor > 0 && options.dampingFactor < 1)) {
    throw new Error("Invalid dampingFactor: expected value in (0,1).");
  }
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) {
    throw new Error("Invalid graph data.");
  }
}

function normalizeMinMax(values: number[]): (val: number) => number {
  if (values.length === 0) return () => 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range === 0) return () => 0;
  return (val: number) => (val - min) / range;
}

export function decorateGraphData(data: GraphData, options: Options): DecoratedGraphData {
  validateOptions(data, options);
  const tStart = Date.now();
  // Structured log: computation start
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ts: nowIso(),
    level: "info",
    event: "client_compute_start",
    nodes: data.nodes.length,
    links: data.links.length,
    seeds_count: options.seeds.size,
    alpha: options.alpha,
    beta: options.beta,
    gamma: options.gamma,
    lambda: options.lambda,
    exponent: options.exponent,
    iterations: options.iterations,
    dampingFactor: options.dampingFactor,
  }));

  const nodeIndex = new Map<string, number>();
  const nodes = data.nodes.slice();
  for (let i = 0; i < nodes.length; i++) {
    nodeIndex.set(nodes[i].id, i);
  }
  const n = nodes.length;
  const outAdj: number[][] = Array.from({ length: n }, () => []);
  for (const l of data.links) {
    const s = nodeIndex.get(l.source);
    const t = nodeIndex.get(l.target);
    if (s !== undefined && t !== undefined) {
      outAdj[s].push(t);
    }
  }

  // Degree (directed, out-degree)
  const deg: number[] = outAdj.map((arr) => arr.length);

  // Multi-source BFS distances (directed)
  const dist: number[] = Array.from({ length: n }, () => Infinity);
  const queue: number[] = [];
  let seedsInGraph = 0;
  for (const sid of options.seeds) {
    const idx = nodeIndex.get(sid);
    if (idx !== undefined) {
      if (dist[idx] !== 0) {
        dist[idx] = 0;
        queue.push(idx);
        seedsInGraph++;
      }
    }
  }
  if (seedsInGraph === 0) {
    throw new Error("None of the provided seeds are present in the graph.");
  }
  while (queue.length > 0) {
    const u = queue.shift() as number;
    const du = dist[u];
    for (const v of outAdj[u]) {
      if (dist[v] === Infinity) {
        dist[v] = du + 1;
        queue.push(v);
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ts: nowIso(),
    level: "info",
    event: "client_bfs_done",
    nodes: n,
    reachable: dist.filter((d) => Number.isFinite(d)).length,
    duration_ms: Date.now() - tStart,
  }));

  // Personalized PageRank (power iteration)
  const v: number[] = Array.from({ length: n }, () => 0);
  for (const sid of options.seeds) {
    const idx = nodeIndex.get(sid);
    if (idx !== undefined) v[idx] = 1;
  }
  const vSum = v.reduce((a, b) => a + b, 0);
  if (vSum <= 0) {
    throw new Error("None of the provided seeds are present in the graph.");
  }
  for (let i = 0; i < n; i++) v[i] = v[i] / vSum;

  const dFact = options.dampingFactor;
  let p: number[] = v.slice(); // start from personalization
  const tPprStart = Date.now();
  for (let it = 0; it < options.iterations; it++) {
    const next: number[] = Array.from({ length: n }, () => 0);
    let danglingMass = 0;
    for (let u = 0; u < n; u++) {
      const outs = outAdj[u];
      if (outs.length === 0) {
        danglingMass += p[u];
      } else {
        const share = p[u] / outs.length;
        for (const vtx of outs) {
          next[vtx] += share;
        }
      }
    }
    // Teleport and dangling redistribution to personalization vector
    for (let i = 0; i < n; i++) {
      next[i] = dFact * next[i] + (1 - dFact) * v[i] + dFact * danglingMass * v[i];
    }
    // Normalize to L1 = 1 to avoid drift
    const s = next.reduce((a, b) => a + b, 0);
    if (s > 0) {
      for (let i = 0; i < n; i++) next[i] /= s;
    }
    p = next;
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ts: nowIso(),
    level: "info",
    event: "client_ppr_done",
    nodes: n,
    iterations: options.iterations,
    dampingFactor: options.dampingFactor,
    duration_ms: Date.now() - tPprStart,
  }));

  // Normalizations
  const normPpr = normalizeMinMax(p);
  const normDeg = normalizeMinMax(deg);

  // Compose decorated nodes
  const nodesOut: DecoratedNode[] = nodes.map((nd, i) => {
    const pprRaw = p[i];
    const degRaw = deg[i];
    const d = dist[i];
    const pprN = normPpr(pprRaw);
    const degN = normDeg(degRaw);
    const distTerm = Number.isFinite(d) ? Math.exp(-options.lambda * (d as number)) : 0;
    const score = options.alpha * pprN + options.beta * degN + options.gamma * distTerm;
    const size = options.sizeMin + (options.sizeMax - options.sizeMin) * Math.pow(score, options.exponent);
    const labelSize = options.labelMin + (options.labelMax - options.labelMin) * Math.pow(score, options.exponent);
    return {
      id: nd.id,
      label: nd.label,
      title: nd.title,
      path: nd.path,
      _ppr: pprRaw,
      _deg: degRaw,
      _dist: Number.isFinite(d) ? (d as number) : null,
      _score: score,
      _size: size,
      _labelSize: labelSize,
    };
  });

  // Link scores as mean of endpoint scores
  const linksOut: DecoratedLink[] = data.links.map((l) => {
    const si = nodeIndex.get(l.source);
    const ti = nodeIndex.get(l.target);
    const s = si !== undefined ? nodesOut[si]._score : 0;
    const t = ti !== undefined ? nodesOut[ti]._score : 0;
    return { ...l, _score: (s + t) / 2 };
  });

  const decorated: DecoratedGraphData = { nodes: nodesOut, links: linksOut };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ts: nowIso(),
    level: "info",
    event: "client_decorate_done",
    nodes: nodesOut.length,
    links: linksOut.length,
    duration_ms: Date.now() - tStart,
  }));
  return decorated;
}
**/