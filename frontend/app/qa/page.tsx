"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { Toast } from "@/components/ui/Toast";
import { apiRequest } from "@/lib/api";

type Citation = {
  node_id?: number | null;
  label?: string | null;
  title: string;
  snippet: string;
  path?: string | null;
  locator?: string | null;
  score?: number | null;
};

type GraphNode = {
  id: number;
  label: string;
  title?: string | null;
};

type GraphEdge = {
  type: string;
  source: number;
  target: number;
};

type GraphPath = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type QaPayload = {
  question: string;
  collection: string;
  top_k: number;
  max_hops: number;
};

type QaResponse = {
  answer: string;
  citations: Citation[];
  graph_paths: GraphPath[];
  cypher_used: string[];
  confidence: number;
};

export default function QAPage() {
  const [collection, setCollection] = useState("");
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(12);
  const [maxHops, setMaxHops] = useState(2);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setError(null);
    setResult(null);
    if (!collection.trim() || !question.trim()) {
      setError("Specify both collection and question.");
      return;
    }

    setLoading(true);
    const payload: QaPayload = {
      collection: collection.trim(),
      question: question.trim(),
      top_k: topK,
      max_hops: maxHops,
    };

    const response = await apiRequest<QaResponse, QaPayload>({
      path: "/qa",
      method: "POST",
      body: payload,
    });
    setLoading(false);

    if (!response.ok || !response.data) {
      setError(response.error ?? "Request failed.");
      return;
    }

    setResult(response.data);
  };

  return (
    <div className="stack">
      {error && <Toast message={error} variant="error" onClose={() => setError(null)} />}

      <section className="panel stack">
        <h2>Ask a Question</h2>
        <p className="text-muted">
          The answer will be generated in Russian strictly from indexed context. When evidence is missing the model
          returns the refusal phrase.
        </p>

        <Input label="Collection" value={collection} onChange={(event) => setCollection(event.target.value)} />

        <label className="field">
          <span className="field-label">Question</span>
          <textarea
            className="field-input"
            rows={5}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Example: Which routines write to register Sales.Turnover?"
          />
        </label>

        <div className="inline">
          <Input
            label="Top K (vectors)"
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(event) => setTopK(Number(event.target.value))}
            style={{ maxWidth: "140px" }}
          />
          <Input
            label="Max hops (graph)"
            type="number"
            min={0}
            max={4}
            value={maxHops}
            onChange={(event) => setMaxHops(Number(event.target.value))}
            style={{ maxWidth: "140px" }}
          />
        </div>

        <Button onClick={ask} loading={loading} disabled={loading}>
          Ask
        </Button>
      </section>

      {loading && (
        <section className="panel inline" style={{ alignItems: "center" }}>
          <Spinner />
          <span>Generating answer…</span>
        </section>
      )}

      {result && !loading && (
        <section className="panel stack">
          <header>
            <h2>Answer</h2>
            <p className="text-muted">Confidence: {(result.confidence * 100).toFixed(1)}%</p>
          </header>

          <div className="card">
            <p>{result.answer}</p>
          </div>

          <div className="card stack">
            <h3>Citations</h3>
            {result.citations.length === 0 ? (
              <p className="text-muted">No supporting chunks were returned.</p>
            ) : (
              result.citations.map((citation, idx) => (
                <div key={`${citation.title}-${idx}`} className="citation">
                  <h4>{citation.title}</h4>
                  {(citation.path || citation.locator) && (
                    <p className="text-muted">
                      {citation.path}
                      {citation.locator ? ` :: ${citation.locator}` : ""}
                    </p>
                  )}
                  <p>{citation.snippet}</p>
                </div>
              ))
            )}
          </div>

          <div className="card stack">
            <h3>Graph Paths</h3>
            {result.graph_paths.length === 0 ? (
              <p className="text-muted">No related graph context was found.</p>
            ) : (
              result.graph_paths.map((path, idx) => (
                <div className="graph-path" key={idx}>
                  <strong>Path {idx + 1}</strong>
                  <ul>
                    {path.nodes.map((node) => (
                      <li key={node.id}>
                        {node.label}: {node.title ?? node.id}
                      </li>
                    ))}
                  </ul>
                  <div className="text-muted">
                    {path.edges.map((edge) => `${edge.source} -[${edge.type}]-> ${edge.target}`).join(" | ")}
                  </div>
                </div>
              ))
            )}
          </div>

          {result.cypher_used.length > 0 && (
            <div className="card stack">
              <h3>Cypher Queries</h3>
              <ul className="file-list">
                {result.cypher_used.map((query, idx) => (
                  <li key={idx} style={{ whiteSpace: "pre-wrap" }}>
                    {query}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
