import { augmentWithFileClusters, type GraphData, type GraphNode, type GraphLink } from '../clusterGraphData';

function makeData(): GraphData {
  const nodes: GraphNode[] = [
    { id: 'a1', label: 'Routine', title: 'Alpha', path: '/p/a' },
    { id: 'a2', label: 'Routine', title: 'Alpha2', path: '/p/a' }, // same path as a1
    { id: 'b1', label: 'Object', title: 'Beta', path: '/p/b' },
    { id: 'nop', label: 'Thing', title: 'NoPath' }, // no path
    { id: 'empty', label: 'X', title: 'EmptyPath', path: '' } // empty string path — should be ignored
  ];
  const links: GraphLink[] = [
    { source: 'a1', target: 'b1', type: 'CALLS' },
    { source: 'a2', target: 'nop', type: 'REFERENCES' }
  ];
  return { nodes, links };
}

describe('augmentWithFileClusters', () => {
  test('creates one File node per unique path with correct id/label/title', () => {
    const input = makeData();
    const out = augmentWithFileClusters(input);
    // Unique non-empty paths: /p/a, /p/b
    const fileNodes = out.nodes.filter((n) => n.label === 'File');
    expect(fileNodes.length).toBe(2);
    const ids = fileNodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['file::/p/a', 'file::/p/b']));
    const titles = fileNodes.map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(['/p/a', '/p/b']));
  });

  test('adds IN_FILE links from node to its File node', () => {
    const input = makeData();
    const out = augmentWithFileClusters(input);
    const added = out.links.filter((l) => l.type === 'IN_FILE');
    // Nodes with paths: a1, a2, b1 (nop, empty ignored) => 3 in-file links
    expect(added.length).toBe(3);
    const keys = new Set(added.map((l) => `${l.source}|${l.target}`));
    expect(keys.has('a1|file::/p/a')).toBe(true);
    expect(keys.has('a2|file::/p/a')).toBe(true);
    expect(keys.has('b1|file::/p/b')).toBe(true);
  });

  test('idempotent: repeated call does not duplicate File nodes and IN_FILE links', () => {
    const input = makeData();
    const once = augmentWithFileClusters(input);
    const twice = augmentWithFileClusters(once);
    const fileOnce = once.nodes.filter((n) => n.label === 'File').length;
    const fileTwice = twice.nodes.filter((n) => n.label === 'File').length;
    expect(fileTwice).toBe(fileOnce);
    const inFileOnce = once.links.filter((l) => l.type === 'IN_FILE').length;
    const inFileTwice = twice.links.filter((l) => l.type === 'IN_FILE').length;
    expect(inFileTwice).toBe(inFileOnce);
  });

  test('ignores nodes without path or with empty path', () => {
    const input = makeData();
    const out = augmentWithFileClusters(input);
    // No file node for empty or missing path
    const badFileNodes = out.nodes.filter((n) => n.id === 'file::' || n.id === 'file::undefined');
    expect(badFileNodes.length).toBe(0);
    const inFileFromNoPath = out.links.filter((l) => l.source === 'nop' || l.source === 'empty').length;
    expect(inFileFromNoPath).toBe(0);
  });

  test('preserves original nodes/links unchanged and appends new ones', () => {
    const input = makeData();
    const inputNodesJson = JSON.stringify(input.nodes);
    const inputLinksJson = JSON.stringify(input.links);
    const out = augmentWithFileClusters(input);
    // Original arrays unchanged
    expect(JSON.stringify(input.nodes)).toBe(inputNodesJson);
    expect(JSON.stringify(input.links)).toBe(inputLinksJson);
    // All original nodes present in output
    for (const n of input.nodes) {
      expect(out.nodes.some((m) => m.id === n.id && m.label === n.label && m.title === n.title && m.path === n.path)).toBe(true);
    }
    // All original links preserved
    for (const l of input.links) {
      expect(out.links.some((k) => k.source === l.source && k.target === l.target && k.type === l.type)).toBe(true);
    }
  });
});