'use client';
import { useEffect, useRef, useState } from 'react';
import SpriteText from 'three-spritetext';
import ForceGraph3D from '3d-force-graph';
import { Group, Mesh, SphereGeometry, MeshBasicMaterial, Color, type Object3D } from 'three';
import { decorateGraphData, type DecoratedGraphData } from './decorateGraphData';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';

type GraphNode = { id: string; label: string; title?: string };
type GraphLink = { source: string; target: string; type: string };
type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

export default function GraphView(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<any>(null);
  const [status, setStatus] = useState('Idle');
  const [collection, setCollection] = useState<string>('');
  const [rels, setRels] = useState<string>('');
  const [limit, setLimit] = useState<number>(2000);
  const [mode, setMode] = useState<'client' | 'server' | ''>('');
  const [seedsCsv, setSeedsCsv] = useState<string>('');
  const [preloadStatus, setPreloadStatus] = useState<string>('Idle');
  const [preloadNodes, setPreloadNodes] = useState<GraphNode[] | null>(null);
  // Explicit options (no silent defaults) - controlled by UI
  const [clientOptions, setClientOptions] = useState({
    alpha: 0.6,
    beta: 0.3,
    gamma: 0.1,
    lambda: 0.8,
    exponent: 1.0,
    sizeMin: 3,
    sizeMax: 18,
    labelMin: 6,
    labelMax: 18,
    iterations: 20,
    dampingFactor: 0.85
  });

  useEffect(() => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const qsCol = params.get('collection') || '';
    if (qsCol) setCollection(qsCol);
    const qsMode = (params.get('mode') || '').trim().toLowerCase();
    if (qsMode === 'client' || qsMode === 'server') {
      setMode(qsMode as 'client' | 'server');
    } else {
      // Default to client mode if not specified in URL
      setMode('client');
    }
    const qsSeeds = params.get('seeds') || '';
    if (qsSeeds) setSeedsCsv(qsSeeds);
  }, []);

  // Background preload of subgraph on collection/rels/limit change.
  useEffect(() => {
    const col = (collection || '').trim();
    if (!col) {
      setPreloadNodes(null);
      setPreloadStatus('Idle');
      return;
    }
    const params = new URLSearchParams();
    params.set('collection', col);
    const r = (rels || '').trim();
    if (r) params.set('rels', r);
    if (Number.isFinite(limit)) params.set('limit', String(limit));
    const url = `/graphview/api/graph?${params.toString()}`;
    const controller = new AbortController();
    const started = Date.now();
    setPreloadStatus('Loading');
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      event: 'api_graph_preload_start',
      collection: col,
      rels: r || '(all)',
      limit
    }));
    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        let payload: any = null;
        try {
          payload = await res.json();
        } catch {
          // ignore parse error to allow fail-fast with HTTP status
        }
        if (!res.ok) {
          const msg = payload && typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`;
          throw new Error(msg);
        }
        const j = payload;
        const nodes: GraphNode[] = Array.isArray(j?.nodes) ? (j.nodes as GraphNode[]) : [];
        setPreloadNodes(nodes);
        setPreloadStatus('Ok');
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          event: 'api_graph_preload_ok',
          collection: col,
          nodes: nodes.length,
          links: Array.isArray(j?.links) ? j.links.length : 0,
          duration_ms: Date.now() - started
        }));
        if (nodes.length > 0) {
          const pick = nodes[Math.floor(Math.random() * nodes.length)];
          setSeedsCsv((prev) => {
            if (prev && prev.trim().length > 0) return prev;
            console.log(JSON.stringify({
              ts: new Date().toISOString(),
              level: 'info',
              event: 'auto_seed_selected',
              collection: col,
              seed: pick.id,
              nodes: nodes.length
            }));
            return pick.id;
          });
        }
      })
      .catch((e) => {
        if ((e as any)?.name === 'AbortError') return;
        setPreloadStatus('Error');
        setPreloadNodes(null);
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'error',
          event: 'api_graph_preload_error',
          collection: col,
          rels: r || '(all)',
          limit,
          message: e instanceof Error ? e.message : String(e)
        }));
      });
    return () => {
      controller.abort();
    };
  }, [collection, rels, limit]);

  useEffect(() => {
    if (!containerRef.current || !ForceGraph3D) return;
    const Graph = ForceGraph3D()(containerRef.current)
      .backgroundColor('#0f172a')
      .nodeRelSize(6)
      .nodeLabel((n: GraphNode & { _score?: number }) => {
        const base = `${n.label}${n.title ? ': ' + n.title : ''}`;
        const sc = typeof (n as any)._score === 'number' ? ` | score: ${(n as any)._score.toFixed(2)}` : '';
        return base + sc;
      })
      .nodeThreeObjectExtend(true)
      .nodeThreeObject((node: GraphNode & { _score?: number; _size?: number; _labelSize?: number }) => {
        const score = typeof (node as any)._score === 'number' ? (node as any)._score : 0;
        const size = typeof (node as any)._size === 'number' ? (node as any)._size : 6;
        const group = new Group();
        const geom = new SphereGeometry(size, 16, 16);
        const color = new Color();
        // HSL mapping: from blue-ish to red-ish, increasing lightness with score
        color.setHSL(0.6 - 0.6 * score, 0.7, 0.35 + 0.45 * score);
        const mat = new MeshBasicMaterial({ color });
        const mesh = new Mesh(geom, mat);
        group.add(mesh);
        const sprite = new SpriteText(node.title || node.label);
        sprite.color = '#ffffff';
        sprite.textHeight = typeof (node as any)._labelSize === 'number' ? (node as any)._labelSize : 12;
        group.add(sprite as unknown as Object3D);
        return group as unknown as Object3D;
      })
      .linkColor(() => '#d2dcff')
      .linkOpacity((l: GraphLink & { _score?: number }) => 0.2 + 0.7 * ((l as any)._score ?? 0))
      .linkWidth((l: GraphLink & { _score?: number }) => 0.2 + 2.8 * ((l as any)._score ?? 0))
      .linkLabel((l: GraphLink) => l.type);

    graphRef.current = Graph;

    const onResize = () => {
      const data: GraphData = Graph.graphData();
      if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) return;
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'client_zoom_fit', reason: 'resize', nodes: data.nodes.length, links: data.links?.length ?? 0 }));
      Graph.zoomToFit(400, 50);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      graphRef.current = null;
    };
  }, []);

  function buildUrl(): string | null {
    const params = new URLSearchParams();
    const col = (collection || '').trim();
    if (!col) return null;
    params.set('collection', col);
    const r = (rels || '').trim();
    if (r) params.set('rels', r);
    if (Number.isFinite(limit)) params.set('limit', String(limit));
    if (mode === 'server') {
      params.set('mode', 'server');
      const seeds = (seedsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
      if (seeds.length === 0) return null;
      params.set('seeds', seeds.join(','));
      params.set('alpha', String(clientOptions.alpha));
      params.set('beta', String(clientOptions.beta));
      params.set('gamma', String(clientOptions.gamma));
      params.set('lambda', String(clientOptions.lambda));
      params.set('exponent', String(clientOptions.exponent));
    }
    return `/graphview/api/graph?${params.toString()}`;
  }

  async function loadGraph(): Promise<void> {
    try {
      // Establish effective seeds snapshot to avoid race with setState
      let effectiveSeedsCsv = seedsCsv;
      // Fail fast behavior for client mode when seeds are not yet selected and no preload is available
      if (mode === 'client') {
        const currentSeeds = (effectiveSeedsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
        const hasSeeds = currentSeeds.length > 0;
        const hasPreload = Array.isArray(preloadNodes) && preloadNodes.length > 0;
        if (!hasSeeds && !hasPreload) {
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'error',
            event: 'client_missing_seeds_logged',
            mode,
            collection,
            rels,
            limit
          }));
          setStatus('Error: Missing seeds for client mode');
          return;
        }
        // If preload exists but seeds are still empty (race), auto-pick one now to avoid empty-seed compute.
        if (!hasSeeds && hasPreload) {
          const pick = preloadNodes![Math.floor(Math.random() * preloadNodes!.length)];
          const picked = String(pick.id);
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'info',
            event: 'auto_seed_selected_on_load',
            collection,
            seed: picked,
            preload_nodes: preloadNodes!.length
          }));
          effectiveSeedsCsv = picked;
          setSeedsCsv(effectiveSeedsCsv);
        }
      }
      const apiUrl = buildUrl();
      if (!apiUrl) {
        setStatus('Provide valid params');
        return;
      }
      setStatus('Loading...');
      const res = await fetch(apiUrl);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any).error || `HTTP ${res.status}`);
      }
      const data: GraphData = await res.json();
      const Graph = graphRef.current;
      if (!Graph) return;
      if (mode === 'client') {
        // Use effective snapshot including possible auto-pick on load
        const seeds = new Set((effectiveSeedsCsv || '').split(',').map(s => s.trim()).filter(Boolean));
        if (seeds.size === 0) {
          throw new Error('Client mode requires seeds for local compute; none provided.');
        }
        const t0 = Date.now();
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          event: 'client_compute_start',
          mode: 'client',
          nodes: data.nodes.length,
          links: data.links.length,
          seeds_count: seeds.size,
          alpha: clientOptions.alpha,
          beta: clientOptions.beta,
          gamma: clientOptions.gamma,
          lambda: clientOptions.lambda,
          exponent: clientOptions.exponent,
          iterations: clientOptions.iterations,
          dampingFactor: clientOptions.dampingFactor
        }));
        const decorated: DecoratedGraphData = decorateGraphData(data, {
          seeds,
          alpha: clientOptions.alpha,
          beta: clientOptions.beta,
          gamma: clientOptions.gamma,
          lambda: clientOptions.lambda,
          exponent: clientOptions.exponent,
          sizeMin: clientOptions.sizeMin,
          sizeMax: clientOptions.sizeMax,
          labelMin: clientOptions.labelMin,
          labelMax: clientOptions.labelMax,
          iterations: clientOptions.iterations,
          dampingFactor: clientOptions.dampingFactor
        });
        Graph.graphData(decorated);
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          event: 'client_decorate_done',
          mode: 'client',
          nodes: decorated.nodes.length,
          links: decorated.links.length,
          duration_ms: Date.now() - t0
        }));
        // trigger zoom-to-fit on physics settle
        (function enableFrame() {
          let armed = true;
          const stopHandler = () => {
            if (!armed) return;
            armed = false;
            Graph.zoomToFit(400, 50);
            Graph.onEngineStop(() => {});
          };
          Graph.onEngineStop(stopHandler);
        })();
        setStatus(`Loaded (client): ${decorated.nodes.length} nodes, ${decorated.links.length} links`);
      } else if (mode === 'server') {
        // Apply client-side styling using server-provided metrics (no recompute, no fallbacks).
        const t0 = Date.now();
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          event: 'client_style_from_server_start',
          mode: 'server',
          nodes: Array.isArray((data as any).nodes) ? (data as any).nodes.length : 0,
          links: Array.isArray((data as any).links) ? (data as any).links.length : 0
        }));
        if (!data || !Array.isArray((data as any).nodes) || !Array.isArray((data as any).links)) {
          throw new Error('Invalid server response shape: nodes/links missing');
        }
        const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
        const { sizeMin, sizeMax, labelMin, labelMax, exponent } = clientOptions;
        const scoreById = new Map<string, number>();
        for (const n of (data as any).nodes as Array<any>) {
          if (!(typeof n.coreScore === 'number') || Number.isNaN(n.coreScore)) {
            throw new Error('Server-mode response missing coreScore; cannot style. No fallbacks.');
          }
          const score = clamp01(n.coreScore);
          (n as any)._score = score;
          (n as any)._size = sizeMin + (sizeMax - sizeMin) * Math.pow(score, exponent);
          (n as any)._labelSize = labelMin + (labelMax - labelMin) * Math.pow(score, exponent);
          scoreById.set(String(n.id), score);
        }
        for (const l of (data as any).links as Array<any>) {
          const s1 = scoreById.get(String(l.source));
          const s2 = scoreById.get(String(l.target));
          if (s1 === undefined || s2 === undefined) {
            throw new Error('Server-mode response contains link with unknown node id; cannot style.');
          }
          (l as any)._score = (s1 + s2) / 2;
        }
        Graph.graphData(data);
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          event: 'client_style_from_server_done',
          mode: 'server',
          nodes: (data as any).nodes.length,
          links: (data as any).links.length,
          duration_ms: Date.now() - t0
        }));
        (function enableFrame() {
          let armed = true;
          const stopHandler = () => {
            if (!armed) return;
            armed = false;
            Graph.zoomToFit(400, 50);
            Graph.onEngineStop(() => {});
          };
          Graph.onEngineStop(stopHandler);
        })();
        setStatus(`Loaded (server): ${data.nodes.length} nodes, ${data.links.length} links`);
      } else {
        throw new Error('Mode is not selected; cannot proceed.');
      }
    } catch (e) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        event: 'client_error',
        mode,
        message: e instanceof Error ? e.message : String(e),
        collection,
        rels,
        limit
      }));
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  function validateParams(): string | null {
    if (!collection.trim()) return 'Provide collection';
    if (mode !== 'client' && mode !== 'server') return 'Select mode';
    if (!Number.isFinite(limit) || limit < 1 || limit > 10000) return 'Limit must be in [1,10000]';
    const seeds = (seedsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
    if (mode === 'server' && seeds.length === 0) return 'Seeds are required for server mode';
    const { alpha, beta, gamma, lambda, exponent, iterations, dampingFactor } = clientOptions;
    const in01 = (x: number) => x >= 0 && x <= 1;
    if (!in01(alpha)) return 'Alpha must be in [0,1]';
    if (!in01(beta)) return 'Beta must be in [0,1]';
    if (!in01(gamma)) return 'Gamma must be in [0,1]';
    if (!in01(lambda)) return 'Lambda must be in [0,1]';
    if (!(exponent > 0)) return 'Exponent must be > 0';
    if (!(Number.isInteger(iterations) && iterations >= 10 && iterations <= 30)) return 'Iterations must be integer in [10,30]';
    if (!(dampingFactor > 0 && dampingFactor < 1)) return 'DampingFactor must be in (0,1)';
    return null;
  }

  const validationError = validateParams();

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a' }}>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(20,24,31,0.95)', borderBottom: '1px solid #223', padding: '8px 12px', display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 8, alignItems: 'center' }}>
        <div style={{ gridColumn: 'span 2' }}>
          <Input
            label="Collection"
            data-testid="input-collection"
            placeholder="collection"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
          />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <Input
            label="Rels (csv)"
            data-testid="input-rels"
            placeholder="CALLS,HAS_ROUTINE"
            value={rels}
            onChange={(e) => setRels(e.target.value)}
          />
        </div>
        <div style={{ gridColumn: 'span 1' }}>
          <Input
            label="Limit"
            data-testid="input-limit"
            type="number"
            min={1}
            max={10000}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <Select
            label="Mode"
            data-testid="select-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'client' | 'server' | '')}
            options={[
              { value: '', label: 'Select mode' },
              { value: 'client', label: 'client' },
              { value: 'server', label: 'server' }
            ]}
          />
        </div>
        <div style={{ gridColumn: 'span 5' }}>
          <Input
            label="Seeds (CSV of ids)"
            data-testid="input-seeds"
            placeholder="1,2,3"
            title="Comma-separated Neo4j node ids used as personalization seeds (stringified ids)."
            value={seedsCsv}
            onChange={(e) => setSeedsCsv(e.target.value)}
          />
        </div>
        <div style={{ gridColumn: 'span 12', display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 8 }}>
          <Input
            label={`alpha (${clientOptions.alpha.toFixed(2)})`}
            data-testid="slider-alpha"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={clientOptions.alpha}
            onChange={(e) => setClientOptions((o) => ({ ...o, alpha: Number(e.target.value) }))}
          />
          <Input
            label={`beta (${clientOptions.beta.toFixed(2)})`}
            data-testid="slider-beta"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={clientOptions.beta}
            onChange={(e) => setClientOptions((o) => ({ ...o, beta: Number(e.target.value) }))}
          />
          <Input
            label={`gamma (${clientOptions.gamma.toFixed(2)})`}
            data-testid="slider-gamma"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={clientOptions.gamma}
            onChange={(e) => setClientOptions((o) => ({ ...o, gamma: Number(e.target.value) }))}
          />
          <Input
            label={`lambda (${clientOptions.lambda.toFixed(2)})`}
            data-testid="slider-lambda"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={clientOptions.lambda}
            onChange={(e) => setClientOptions((o) => ({ ...o, lambda: Number(e.target.value) }))}
          />
          <Input
            label={`exponent (${clientOptions.exponent.toFixed(2)})`}
            data-testid="slider-exponent"
            type="range"
            min={0.2}
            max={1.5}
            step={0.05}
            value={clientOptions.exponent}
            onChange={(e) => setClientOptions((o) => ({ ...o, exponent: Number(e.target.value) }))}
          />
          <Input
            label={`iterations (${clientOptions.iterations})`}
            data-testid="input-iterations"
            type="number"
            min={10}
            max={30}
            step={1}
            value={clientOptions.iterations}
            onChange={(e) => setClientOptions((o) => ({ ...o, iterations: Number(e.target.value) }))}
          />
          <Input
            label={`damping (${clientOptions.dampingFactor.toFixed(2)})`}
            data-testid="slider-damping"
            type="range"
            min={0.05}
            max={0.95}
            step={0.01}
            value={clientOptions.dampingFactor}
            onChange={(e) => setClientOptions((o) => ({ ...o, dampingFactor: Number(e.target.value) }))}
          />
        </div>
        <div style={{ gridColumn: 'span 3', display: 'flex', gap: 8 }}>
          <Button
            data-testid="btn-load"
            onClick={loadGraph}
            disabled={Boolean(validationError)}
          >
            Load
          </Button>
          <Button
            data-testid="btn-recenter"
            variant="secondary"
            onClick={() => { const g = graphRef.current; if (!g) return; const data: GraphData = g.graphData(); if (!data?.nodes?.length) return; g.zoomToFit(400,50); }}
            title="Re-center / Zoom to fit"
          >
            Re-center
          </Button>
        </div>
        <div style={{ gridColumn: 'span 9', fontSize: 12, opacity: 0.8 }}>
          {validationError ? `Validation: ${validationError}` : `${status} | Preload: ${preloadStatus}`}
        </div>
      </div>
      <div ref={containerRef} data-testid="graph-container" style={{ position: 'absolute', top: 160, left: 0, right: 0, bottom: 0 }} />
    </div>
  );
}
