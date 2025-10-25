export type Node = { id: string; label?: string; title?: string; path?: string };
export type Link = { source: string; target: string; type?: string };
export type GraphData = { nodes: Node[]; links: Link[] };

export type DecoratedNode = Node & {
	_pr: number; // global PageRank (raw)
	_deg: number; // undirected degree
	_kcore: number; // k-core number (coreness)
	_score: number; // blended importance
	_size: number; // visual radius
	_labelSize: number; // label size
};
export type DecoratedLink = Link & { _score: number };
export type DecoratedGraphData = { nodes: DecoratedNode[]; links: DecoratedLink[] };

type Options = {
	alpha: number; // weight for PageRank
	beta: number; // weight for degree
	gamma: number; // weight for k-core
	exponent: number; // size/label nonlinearity (>0)
	sizeMin: number;
	sizeMax: number;
	labelMin: number;
	labelMax: number;
	iterations: number; // PR power iterations (10..30)
	dampingFactor: number; // PR damping (0,1)
};

function nowIso(): string {
	return new Date().toISOString();
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

function validate(data: GraphData, opt: Options): void {
	if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) {
		throw new Error("Invalid graph data.");
	}
	const in01 = (x: number) => x >= 0 && x <= 1;
	if (!in01(opt.alpha)) throw new Error("alpha must be in [0,1].");
	if (!in01(opt.beta)) throw new Error("beta must be in [0,1].");
	if (!in01(opt.gamma)) throw new Error("gamma must be in [0,1].");
	if (!(opt.exponent > 0)) throw new Error("exponent must be > 0.");
	if (!(Number.isInteger(opt.iterations) && opt.iterations >= 10 && opt.iterations <= 30)) {
		throw new Error("iterations must be integer in [10,30].");
	}
	if (!(opt.dampingFactor > 0 && opt.dampingFactor < 1)) {
		throw new Error("dampingFactor must be in (0,1).");
	}
	if (data.nodes.length === 0) {
		throw new Error("Graph contains no nodes.");
	}
}

export function decorateGraphDataSeedless(data: GraphData, opt: Options): DecoratedGraphData {
	validate(data, opt);
	const t0 = Date.now();
	// eslint-disable-next-line no-console
	console.log(JSON.stringify({
		ts: nowIso(),
		level: "info",
		event: "seedless_compute_start",
		nodes: data.nodes.length,
		links: data.links.length,
		alpha: opt.alpha,
		beta: opt.beta,
		gamma: opt.gamma,
		exponent: opt.exponent,
		iterations: opt.iterations,
		dampingFactor: opt.dampingFactor
	}));

	// Indexing
	const nodes = data.nodes.slice();
	const nodeIndex = new Map<string, number>();
	for (let i = 0; i < nodes.length; i++) nodeIndex.set(String(nodes[i].id), i);
	const n = nodes.length;

	// Build directed out adjacency (for PR) and undirected neighbors (for degree/k-core)
	const outAdj: number[][] = Array.from({ length: n }, () => []);
	const undirected: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
	for (const l of data.links) {
		const s = nodeIndex.get(String(l.source));
		const t = nodeIndex.get(String(l.target));
		if (s === undefined || t === undefined) continue;
		outAdj[s].push(t);
		if (s !== t) {
			undirected[s].add(t);
			undirected[t].add(s);
		}
	}

	// Degree (undirected)
	const deg: number[] = undirected.map((set) => set.size);

	// k-core via lazy bucket queue (degeneracy ordering)
	const maxDeg = deg.reduce((a, b) => (a > b ? a : b), 0);
	const bins: number[][] = Array.from({ length: maxDeg + 1 }, () => []);
	const currentDeg: number[] = deg.slice();
	const removed: boolean[] = Array(n).fill(false);
	const core: number[] = Array(n).fill(0);
	for (let i = 0; i < n; i++) bins[currentDeg[i]].push(i);
	let processed = 0;
	let ptr = 0;
	while (processed < n) {
		while (ptr <= maxDeg && bins[ptr].length === 0) ptr++;
		if (ptr > maxDeg) break;
		const v = bins[ptr].pop() as number;
		if (removed[v]) continue;
		if (currentDeg[v] !== ptr) {
			bins[currentDeg[v]].push(v);
			continue;
		}
		removed[v] = true;
		core[v] = ptr;
		processed++;
		for (const u of undirected[v]) {
			if (removed[u]) continue;
			if (currentDeg[u] > 0) {
				currentDeg[u] -= 1;
				bins[currentDeg[u]].push(u);
			}
		}
	}

	// Global PageRank (uniform teleport)
	const dFact = opt.dampingFactor;
	const uniformTeleport = 1 / n;
	let p: number[] = Array.from({ length: n }, () => uniformTeleport);
	for (let it = 0; it < opt.iterations; it++) {
		const next: number[] = Array.from({ length: n }, () => 0);
		let danglingMass = 0;
		for (let u = 0; u < n; u++) {
			const outs = outAdj[u];
			if (outs.length === 0) {
				danglingMass += p[u];
			} else {
				const share = p[u] / outs.length;
				for (const v of outs) next[v] += share;
			}
		}
		for (let i = 0; i < n; i++) {
			next[i] = dFact * next[i] + (1 - dFact) * uniformTeleport + dFact * danglingMass * uniformTeleport;
		}
		const s = next.reduce((a, b) => a + b, 0);
		if (s > 0) {
			for (let i = 0; i < n; i++) next[i] /= s;
		}
		p = next;
	}

	// Normalize signals
	const prNorm = normalizeMinMax(p);
	const degNorm = normalizeMinMax(deg);
	const kcoreNorm = normalizeMinMax(core);

	// Compose nodes
	const nodesOut = nodes.map((nd, i) => {
		const prN = prNorm(p[i]);
		const dN = degNorm(deg[i]);
		const kcN = kcoreNorm(core[i]);
		const score = opt.alpha * prN + opt.beta * dN + opt.gamma * kcN;
		const size = opt.sizeMin + (opt.sizeMax - opt.sizeMin) * Math.pow(score, opt.exponent);
		const labelSize = opt.labelMin + (opt.labelMax - opt.labelMin) * Math.pow(score, opt.exponent);
		return {
			id: nd.id,
			label: nd.label,
			title: nd.title,
			path: nd.path,
			_pr: p[i],
			_deg: deg[i],
			_kcore: core[i],
			_score: score,
			_size: size,
			_labelSize: labelSize
		};
	});

	// Link scores as mean of endpoint scores
	const idx = nodeIndex;
	const linksOut = data.links.map((l) => {
		const si = idx.get(String(l.source));
		const ti = idx.get(String(l.target));
		const s = si !== undefined ? nodesOut[si]._score : 0;
		const t = ti !== undefined ? nodesOut[ti]._score : 0;
		return { ...l, _score: (s + t) / 2 } as DecoratedLink;
	});

	const out = { nodes: nodesOut, links: linksOut };
	// eslint-disable-next-line no-console
	console.log(JSON.stringify({
		ts: nowIso(),
		level: "info",
		event: "seedless_compute_done",
		nodes: nodesOut.length,
		links: linksOut.length,
		duration_ms: Date.now() - t0
	}));
	return out;
}


