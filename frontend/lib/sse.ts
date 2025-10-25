type SSEHandler = (event: MessageEvent) => void;

export function subscribeToSSE(url: string, handler: SSEHandler): () => void {
  const source = new EventSource(url, { withCredentials: false });
  source.onmessage = handler;
  source.onerror = () => {
    source.close();
  };
  return () => source.close();
}
