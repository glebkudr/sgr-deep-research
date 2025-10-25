export type LabelNode = {
  label: string;
  title?: string;
  path?: string;
  _score?: number;
};

type BuildOptions = {
  maxPathLen?: number; // UI-only constraint; does not affect data. Must be >= 4 to be effective
};

export function middleTruncate(text: string, maxLen: number): string {
  if (typeof text !== 'string') return '';
  if (!Number.isFinite(maxLen) || maxLen <= 0) return text;
  if (text.length <= maxLen) return text;
  if (maxLen <= 3) return '…'.repeat(Math.max(1, maxLen));
  const left = Math.floor((maxLen - 1) / 2);
  const right = maxLen - 1 - left;
  return text.slice(0, left) + '…' + text.slice(text.length - right);
}

export function buildNodeLabel(node: LabelNode, options?: BuildOptions): string {
  // Base: label and optional title
  const base = `${node.label}${node.title ? ': ' + node.title : ''}`;
  // Optional score (2 decimals), if present
  const sc = typeof node._score === 'number' ? ` | score: ${node._score.toFixed(2)}` : '';
  // Optional path (middle-truncated for readability), if present and non-empty
  let pathPart = '';
  if (typeof node.path === 'string' && node.path.length > 0) {
    const maxLen = typeof options?.maxPathLen === 'number' && options.maxPathLen >= 4 ? options.maxPathLen : 120;
    const shown = middleTruncate(node.path, maxLen);
    pathPart = ` | path: ${shown}`;
  }
  return base + sc + pathPart;
}


