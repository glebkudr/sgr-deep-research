'use client';
import { useEffect, useRef, useState } from 'react';
import SpriteText from 'three-spritetext';
import ForceGraph3D from '3d-force-graph';
import type { Object3D } from 'three';

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

  useEffect(() => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const qsCol = params.get('collection') || '';
    if (qsCol) setCollection(qsCol);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !ForceGraph3D) return;
    const Graph = ForceGraph3D()(containerRef.current)
      .backgroundColor('#0f172a')
      .nodeRelSize(6)
      .nodeAutoColorBy('label')
      .nodeLabel((n: GraphNode) => `${n.label}${n.title ? ': ' + n.title : ''}`)
      .nodeThreeObjectExtend(true)
      .nodeThreeObject((node: GraphNode) => {
        const sprite = new SpriteText(node.title || node.label);
        sprite.color = colorForLabel(node.label);
        sprite.textHeight = 14;
        return sprite as unknown as Object3D;
      })
      .linkColor(() => 'rgba(210,220,255,0.6)')
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


