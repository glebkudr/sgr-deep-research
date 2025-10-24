export type GraphNode = { id: string; label: string; title?: string; path?: string };
export type GraphLink = { source: string; target: string; type: string };
export type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

function nowIso(): string {
  return new Date().toISOString();
}

export function augmentWithFileClusters(data: GraphData): GraphData {
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) {
    throw new Error("Invalid graph data for clustering augmentation.");
  }
  // Structured log: start
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ts: nowIso(),
    level: "info",
    event: "cluster_augment_start",
    nodes_before: data.nodes.length,
    links_before: data.links.length
  }));

  const nodes = data.nodes.slice();
  const links = data.links.slice();

  const nodeIdSet = new Set(nodes.map(n => String(n.id)));
  const linkKeySet = new Set(links.map(l => `${l.source}|${l.target}|${l.type}`));

  const pathGroups = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (typeof n.path === "string" && n.path.length > 0) {
      const arr = pathGroups.get(n.path) ?? [];
      arr.push(n);
      if (!pathGroups.has(n.path)) pathGroups.set(n.path, arr);
    }
  }

  const fileNodesToAdd: GraphNode[] = [];
  const inFileLinksToAdd: GraphLink[] = [];

  for (const [path, groupNodes] of pathGroups.entries()) {
    const superId = `file::${path}`;
    if (!nodeIdSet.has(superId)) {
      // Create super node for file path
      fileNodesToAdd.push({
        id: superId,
        label: "File",
        title: path,
        path
      });
      nodeIdSet.add(superId);
    }
    // IN_FILE links for members
    for (const member of groupNodes) {
      const key = `${member.id}|${superId}|IN_FILE`;
      if (!linkKeySet.has(key)) {
        inFileLinksToAdd.push({
          source: String(member.id),
          target: superId,
          type: "IN_FILE"
        });
        linkKeySet.add(key);
      }
    }
  }

  const out: GraphData = {
    nodes: nodes.concat(fileNodesToAdd),
    links: links.concat(inFileLinksToAdd)
  };

  // Structured logs: stats + finish
  const uniquePaths = pathGroups.size;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ts: nowIso(),
    level: "info",
    event: "cluster_augment_stats",
    unique_paths: uniquePaths,
    added_file_nodes: fileNodesToAdd.length,
    added_in_file_links: inFileLinksToAdd.length
  }));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ts: nowIso(),
    level: "info",
    event: "cluster_augment_finish",
    nodes_after: out.nodes.length,
    links_after: out.links.length
  }));
  return out;
}