'use client';
import { useEffect, useRef, useState } from 'react';
import SpriteText from 'three-spritetext';
import ForceGraph3D from '3d-force-graph';
import { Group, Mesh, SphereGeometry, MeshBasicMaterial, Color, type Object3D } from 'three';
import { decorateGraphData, type DecoratedGraphData } from './decorateGraphData';

type GraphNode = { id: string; label: string; title?: string };
type GraphLink = { source: string; target: string; type: string };
type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

function colorForLabel(label: string): string {
  const palette = [
    '#8ac7ff', '#9affc7', '#ffb3ba', '#d7b3ff', '#ffd39a',
    '#b3fff6', '#ffdfba', '#c9ff9a', '#ff9af2', '#b1b1ff'
  ];
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export default function GraphView(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<any>(null);
  const [status, setStatus] = useState('Idle');
  const [collection, setCollection] = useState<string>('');
  const [rels, setRels] = useState<string>('');
  const [limit, setLimit] = useState<number>(2000);
  const [mode, setMode] = useState<'client' | 'server' | ''>('');
  const [seedsCsv, setSeedsCsv] = useState<string>('');
  // Explicit client-mode options (no silent defaults)
  const [clientOptions] = useState({
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
    if (qsMode === 'client' || qsMode === 'server') setMode(qsMode as 'client' | 'server');
    const qsSeeds = params.get('seeds') || '';
    if (qsSeeds) setSeedsCsv(qsSeeds);
  }, []);

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
    let shouldFrameOnStop = false;
    Graph.onEngineStop(() => {
      if (!shouldFrameOnStop) return;
      const data: GraphData = Graph.graphData();
      if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) return;
      shouldFrameOnStop = false;
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'client_zoom_fit', reason: 'engine_stop', nodes: data.nodes.length, links: data.links?.length ?? 0 }));
      Graph.zoomToFit(400, 50);
    });

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
    return `/graphview/api/graph?${params.toString()}`;
  }

  async function loadGraph(): Promise<void> {
    const apiUrl = buildUrl();
    if (!apiUrl) {
      setStatus('Provide collection');
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
      const seeds = new Set((seedsCsv || '').split(',').map(s => s.trim()).filter(Boolean));
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
      try {
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
      } catch (e) {
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'error',
          event: 'client_error',
          mode: 'client',
          message: String(e),
          nodes: data.nodes.length,
          links: data.links.length
        }));
        setStatus(`Client error: ${(e as Error).message}`);
        return;
      }
    } else {
      // default/server or unspecified mode: show raw data (no fallbacks to client)
      Graph.graphData(data);
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
      setStatus(`Loaded: ${data.nodes.length} nodes, ${data.links.length} links`);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a' }}>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(20,24,31,0.95)', borderBottom: '1px solid #223', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.85 }}>Collection:</span>
        <input value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="collection" size={18} style={{ background: '#0f141b', color: '#e6e6e6', border: '1px solid #2a3a50', borderRadius: 6, padding: '6px 8px' }} />
        <span style={{ fontSize: 12, opacity: 0.85 }}>Rels (csv):</span>
        <input value={rels} onChange={(e) => setRels(e.target.value)} placeholder="CALLS,HAS_ROUTINE" size={22} style={{ background: '#0f141b', color: '#e6e6e6', border: '1px solid #2a3a50', borderRadius: 6, padding: '6px 8px' }} />
        <span style={{ fontSize: 12, opacity: 0.85 }}>Limit:</span>
        <input value={limit} onChange={(e) => setLimit(Number(e.target.value))} type="number" min={1} max={10000} style={{ width: 90, background: '#0f141b', color: '#e6e6e6', border: '1px solid #2a3a50', borderRadius: 6, padding: '6px 8px' }} />
        <button onClick={loadGraph} style={{ background: '#0f141b', color: '#e6e6e6', border: '1px solid #2a3a50', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}>Load</button>
        <button onClick={() => { const g = graphRef.current; if (!g) return; const data: GraphData = g.graphData(); if (!data?.nodes?.length) return; g.zoomToFit(400,50); }} title="Re-center / Zoom to fit" style={{ background: '#0f141b', color: '#e6e6e6', border: '1px solid #2a3a50', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}>Re-center</button>
        <div style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.8 }}>{status}</div>
      </div>
      <div ref={containerRef} style={{ position: 'absolute', top: 48, left: 0, right: 0, bottom: 0 }} />
    </div>
  );
}


