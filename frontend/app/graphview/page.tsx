'use client';
import { useEffect, useRef, useState } from 'react';
import SpriteText from 'three-spritetext';
import ForceGraph3D from '3d-force-graph';
import { Group, Mesh, SphereGeometry, MeshBasicMaterial, Color, type Object3D } from 'three';
import { decorateGraphData, type DecoratedGraphData } from './decorateGraphData';
import { decorateGraphDataSeedless, type DecoratedGraphData as DecoratedGraphDataSeedless } from './decorateGraphDataSeedless';
import { augmentWithFileClusters } from './clusterGraphData';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';

type GraphNode = { id: string; label: string; title?: string; path?: string };
type GraphLink = { source: string; target: string; type: string };
type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

export default function GraphView(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<any>(null);
  const [status, setStatus] = useState('Idle');
  const [collection, setCollection] = useState<string>('');
  const [rels, setRels] = useState<string>('');
  const [limit, setLimit] = useState<number>(2000);
  const [mode, setMode] = useState<'global'>('global');
  const [seedsCsv, setSeedsCsv] = useState<string>('');
  const [preloadStatus, setPreloadStatus] = useState<string>('Idle');
  const [preloadNodes, setPreloadNodes] = useState<GraphNode[] | null>(null);
  const [clusterByPath, setClusterByPath] = useState<boolean>(false);
  // Explicit options (no silent defaults) - controlled by UI
  const [clientOptions, setClientOptions] = useState({
    alpha: 0.2,
    beta: 0.05,
    gamma: 0.2,
    lambda: 0.8,
    exponent: 1.0,
    sizeMin: 3,
    sizeMax: 18,
    labelMin: 6,
    labelMax: 18,
    iterations: 20,
    dampingFactor: 0.85,
    nodeOpacity: 0.7
  });

  useEffect(() => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const qsCol = params.get('collection') || '';
    if (qsCol) setCollection(qsCol);
    const qsMode = (params.get('mode') || '').trim().toLowerCase();
    if (qsMode === 'global') {
      setMode('global');
    } else {
      setMode('global');
    }
    const qsSeeds = params.get('seeds') || '';
    if (qsSeeds) setSeedsCsv(qsSeeds);
  }, []);

  // Keep node opacity reactive inside nodeThreeObject without re-instantiating the graph
  const nodeOpacityRef = useRef<number>(0.7);
  useEffect(() => {
    nodeOpacityRef.current = clientOptions.nodeOpacity;
  }, [clientOptions.nodeOpacity]);

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
        } catch (err) {
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'error',
            event: 'api_graph_preload_parse_error',
            collection: col,
            rels: r || '(all)',
            limit,
            status: res.status,
            message: err instanceof Error ? err.message : String(err)
          }));
          throw err;
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
      .nodeThreeObjectExtend(false)
      .nodeThreeObject((node: GraphNode & { _score?: number; _size?: number; _labelSize?: number }) => {
        const score = typeof (node as any)._score === 'number' ? (node as any)._score : 0;
        const size = typeof (node as any)._size === 'number' ? (node as any)._size : 6;
        const group = new Group();
        const isFile = node.label === 'File';
        const baseSize = isFile ? size * 1.15 : size;
        const geom = new SphereGeometry(baseSize, 16, 16);
        const color = new Color();
        if (isFile) {
          color.set('#ffcc66');
        } else {
          // HSL mapping: from blue-ish to red-ish, increasing lightness with score
          color.setHSL(0.6 - 0.6 * score, 0.7, 0.35 + 0.45 * score);
        }
        const mat = new MeshBasicMaterial({ color, transparent: true, opacity: nodeOpacityRef.current });
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
    // Configure d3-force link distances/strengths with special handling for IN_FILE
    const linkForce: any = Graph.d3Force && Graph.d3Force('link');
    const canConfig = linkForce && typeof linkForce.distance === 'function' && typeof linkForce.strength === 'function';
    if (canConfig) {
      linkForce
        .distance((l: any) => (l && l.type === 'IN_FILE' ? 14 : 60))
        .strength((l: any) => (l && l.type === 'IN_FILE' ? 1.0 : 0.15));
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        event: 'd3force_configured',
        distance_in_file: 14,
        strength_in_file: 1.0,
        distance_other: 60,
        strength_other: 0.15
      }));
    } else {
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        event: 'd3force_config_skipped',
        reason: 'linkForce not available'
      }));
    }

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
    // global mode does not require extra params
    return `/graphview/api/graph?${params.toString()}`;
  }

  async function loadGraph(): Promise<void> {
    try {
      // global-only mode; no seeds handling
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
      {
        const t0 = Date.now();
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          event: 'seedless_style_start',
          mode: 'global',
          nodes: (data as any)?.nodes?.length ?? 0,
          links: (data as any)?.links?.length ?? 0,
          alpha: clientOptions.alpha,
          beta: clientOptions.beta,
          gamma: clientOptions.gamma,
          exponent: clientOptions.exponent,
          iterations: clientOptions.iterations,
          dampingFactor: clientOptions.dampingFactor
        }));

        const decorated: DecoratedGraphDataSeedless = decorateGraphDataSeedless(data, {
          alpha: clientOptions.alpha,
          beta: clientOptions.beta,
          gamma: clientOptions.gamma,
          exponent: clientOptions.exponent,
          sizeMin: clientOptions.sizeMin,
          sizeMax: clientOptions.sizeMax,
          labelMin: clientOptions.labelMin,
          labelMax: clientOptions.labelMax,
          iterations: clientOptions.iterations,
          dampingFactor: clientOptions.dampingFactor
        });

        let finalData: any = decorated;
        if (clusterByPath) {
          const beforeNodes = decorated.nodes.length;
          const beforeLinks = decorated.links.length;
          const uniquePaths = new Set(
            data.nodes
              .filter((n) => typeof n.path === 'string' && (n.path as string).length > 0)
              .map((n) => n.path as string)
          ).size;
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'info',
            event: 'cluster_augment_start',
            unique_paths: uniquePaths,
            nodes_before: beforeNodes,
            links_before: beforeLinks
          }));
          finalData = augmentWithFileClusters(decorated as any) as any;

          const idToNode = new Map<string, any>();
          for (const n of finalData.nodes) idToNode.set(String(n.id), n);
          const childrenByFile = new Map<string, string[]>();
          for (const l of finalData.links) {
            if (l.type === 'IN_FILE') {
              const tgt = String(l.target);
              const src = String(l.source);
              const arr = childrenByFile.get(tgt) ?? [];
              arr.push(src);
              if (!childrenByFile.has(tgt)) childrenByFile.set(tgt, arr);
            }
          }
          for (const n of finalData.nodes as any[]) {
            if (n.label === 'File') {
              const children = childrenByFile.get(String(n.id)) ?? [];
              if (children.length === 0) continue;
              const childScores: number[] = [];
              for (const cid of children) {
                const cn = idToNode.get(String(cid));
                if (!cn || typeof cn._score !== 'number') {
                  throw new Error('Missing _score on child node for File cluster computation.');
                }
                childScores.push(cn._score);
              }
              const maxScore = childScores.reduce((a, b) => (a > b ? a : b), -Infinity);
              n._score = maxScore;
              n._size = clientOptions.sizeMin + (clientOptions.sizeMax - clientOptions.sizeMin) * Math.pow(maxScore, clientOptions.exponent);
              n._labelSize = clientOptions.labelMin + (clientOptions.labelMax - clientOptions.labelMin) * Math.pow(maxScore, clientOptions.exponent);
            }
          }
          // Set _score for IN_FILE links as average of endpoints
          for (const l of finalData.links as any[]) {
            if (l.type === 'IN_FILE') {
              const sNode = idToNode.get(String(l.source));
              const tNode = idToNode.get(String(l.target));
              if (!sNode || !tNode || typeof sNode._score !== 'number' || typeof tNode._score !== 'number') {
                throw new Error('Cannot compute IN_FILE link score: endpoint scores missing.');
              }
              l._score = (sNode._score + tNode._score) / 2;
            }
          }
          const afterNodes = finalData.nodes.length;
          const afterLinks = finalData.links.length;
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'info',
            event: 'cluster_augment_finish',
            nodes_after: afterNodes,
            links_after: afterLinks,
            added_nodes: afterNodes - beforeNodes,
            added_links: afterLinks - beforeLinks
          }));
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'info',
            event: 'cluster_augment_stats',
            unique_paths: uniquePaths,
            nodes_with_path: data.nodes.filter(n => typeof n.path === 'string' && (n.path as string).length > 0).length,
            nodes_without_path: data.nodes.filter(n => !n.path || (typeof n.path === 'string' && (n.path as string).length === 0)).length
          }));
        }

        Graph.graphData(finalData);
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          event: 'seedless_style_done',
          mode: 'global',
          nodes: (finalData.nodes as any[]).length,
          links: (finalData.links as any[]).length,
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
        const dGD = Graph.graphData() as GraphData;
        setStatus(`Loaded (global): ${dGD.nodes.length} nodes, ${dGD.links.length} links`);
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
    // single mode: global
    if (!Number.isFinite(limit) || limit < 1 || limit > 10000) return 'Limit must be in [1,10000]';
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
            onChange={() => setMode('global')}
            options={[
              { value: 'global', label: 'global (no seeds)' },
            ]}
          />
        </div>
        {/* Seeds input removed for global-only mode */}
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
          <Input
            label={`node opacity (${clientOptions.nodeOpacity.toFixed(2)})`}
            data-testid="slider-node-opacity"
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={clientOptions.nodeOpacity}
            onChange={(e) => setClientOptions((o) => ({ ...o, nodeOpacity: Number(e.target.value) }))}
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
        <div style={{ gridColumn: 'span 3', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              data-testid="checkbox-cluster-by-path"
              checked={clusterByPath}
              onChange={(e) => {
                const enabled = e.target.checked;
                setClusterByPath(enabled);
                console.log(JSON.stringify({
                  ts: new Date().toISOString(),
                  level: 'info',
                  event: 'cluster_toggle_changed',
                  enabled,
                  mode,
                  collection
                }));
              }}
            />
            <span style={{ color: '#e5e7eb', fontSize: 12 }}>Cluster by file (path) — reload to apply</span>
          </label>
        </div>
        <div style={{ gridColumn: 'span 9', fontSize: 12, opacity: 0.8 }}>
          {validationError ? `Validation: ${validationError}` : `${status} | Preload: ${preloadStatus}`}
        </div>
      </div>
      <div ref={containerRef} data-testid="graph-container" style={{ position: 'absolute', top: 160, left: 0, right: 0, bottom: 0 }} />
    </div>
  );
}
