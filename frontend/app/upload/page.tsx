"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SegmentedProgressBar } from "@/components/ui/SegmentedProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import { Toast } from "@/components/ui/Toast";
import { apiRequest } from "@/lib/api";

type JobStatus = "PENDING" | "RUNNING" | "DONE" | "ERROR";

type JobStats = {
  processed_files: number;
  total_files: number;
  nodes: number;
  edges: number;
  vector_chunks: number;
  embedded_chunks?: number;
  graph_nodes_total?: number;
  graph_nodes_written?: number;
  graph_edges_total?: number;
  graph_edges_written?: number;
  duration_sec: number;
  phase?: string;
  session_segments?: number[];
  session_batches?: number;
  session_total_files?: number;
};

type JobRecord = {
  job_id: string;
  collection: string;
  status: JobStatus;
  stats: JobStats;
  errors: { message: string; path?: string }[];
};

type RecentJob = {
  jobId: string;
  collection: string;
  status: JobStatus;
  updatedAt: string;
};

const RECENTS_KEY = "graphrag_recent_jobs";
const POLL_INTERVAL_MS = 1500;
export default function UploadPage() {
  const [collection, setCollection] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant?: "info" | "success" | "error" } | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

const allowed = useMemo(() => new Set(["bsl", "xml", "html", "htm", "txt"]), []);

  useEffect(() => {
    // Enable directory selection on supported browsers
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute("webkitdirectory", "");
      fileInputRef.current.setAttribute("directory", "");
    }
    // defer loading recent jobs to client after mount to avoid hydration mismatch
    setRecentJobs(loadRecentJobs());
    if (!jobId) return;
    const timer = setInterval(async () => {
      const response = await apiRequest<JobRecord>({ path: `/jobs/${jobId}` });
      if (response.ok && response.data) {
        setJob(response.data);
        if (["DONE", "ERROR"].includes(response.data.status)) {
          clearInterval(timer);
          updateRecentJobs(response.data);
        }
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [jobId]);

  const updateRecentJobs = useCallback((data: JobRecord) => {
    const record: RecentJob = {
      jobId: data.job_id,
      collection: data.collection,
      status: data.status,
      updatedAt: new Date().toISOString(),
    };
    setRecentJobs((prev) => {
      const merged = [record, ...prev.filter((item) => item.jobId !== record.jobId)].slice(0, 5);
      saveRecentJobs(merged);
      return merged;
    });
  }, []);

  useEffect(() => {
    if (job && ["DONE", "ERROR"].includes(job.status)) {
      updateRecentJobs(job);
    }
  }, [job, updateRecentJobs]);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const chosen = Array.from(event.target.files ?? []);
    const filtered = chosen.filter((file) => {
      const ext = (file.webkitRelativePath || file.name).toLowerCase().split(".").pop() ?? "";
      return allowed.has(ext);
    });
    if (filtered.length !== chosen.length) {
      setToast({
        message: "Некоторые файлы были отклонены: поддерживаются .bsl, .xml, .html, .txt.",
        variant: "error",
      });
    }
    setFiles(filtered);
  };

  const onSubmit = async () => {
    setError(null);
    setToast(null);
    const trimmedCollection = collection.trim();
    if (!trimmedCollection) {
      setError("Collection is required.");
      return;
    }
    if (!files.length) {
      setError("Choose at least one file to upload.");
      return;
    }

    setIsUploading(true);

    const initPayload = new FormData();
    initPayload.append("collection", trimmedCollection);
    const initResponse = await apiRequest<{ upload_id: string; batch_size: number }>({
      path: "/upload/init",
      method: "POST",
      body: initPayload,
    });
    if (!initResponse.ok || !initResponse.data) {
      setIsUploading(false);
      setToast({ message: initResponse.error ?? "Failed to start upload session.", variant: "error" });
      return;
    }

    const { upload_id: uploadId, batch_size: batchSize } = initResponse.data;
    if (!Number.isFinite(batchSize) || batchSize <= 0) {
      setIsUploading(false);
      setToast({ message: "Upload session returned invalid batch size.", variant: "error" });
      return;
    }

    const batches: File[][] = [];
    for (let index = 0; index < files.length; index += batchSize) {
      batches.push(files.slice(index, index + batchSize));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      const partPayload = new FormData();
      partPayload.append("upload_id", uploadId);
      batch.forEach((file) => {
        const rel = (file as any).webkitRelativePath || file.name;
        partPayload.append("files", file, rel);
      });
      const partResponse = await apiRequest<{ saved: number }>({
        path: "/upload/part",
        method: "POST",
        body: partPayload,
      });
      if (!partResponse.ok || !partResponse.data) {
        setIsUploading(false);
        setToast({
          message: partResponse.error ?? `Upload failed while processing batch ${batchIndex + 1}.`,
          variant: "error",
        });
        return;
      }
    }

    const completePayload = new FormData();
    completePayload.append("upload_id", uploadId);
    const completeResponse = await apiRequest<{ job_id: string }>({
      path: "/upload/complete",
      method: "POST",
      body: completePayload,
    });
    setIsUploading(false);
    if (!completeResponse.ok || !completeResponse.data) {
      setToast({ message: completeResponse.error ?? "Upload session completion failed.", variant: "error" });
      return;
    }

    setJob(null);
    setJobId(completeResponse.data.job_id);
    setToast({ message: "Upload session completed. Indexing job created.", variant: "success" });
  };
  const onSelectJob = async (jobIdToLoad: string) => {
    const response = await apiRequest<JobRecord>({ path: `/jobs/${jobIdToLoad}` });
    if (response.ok && response.data) {
      setJobId(jobIdToLoad);
      setJob(response.data);
      setCollection(response.data.collection);
      setToast({ message: "Загружен статус задачи.", variant: "info" });
    }
  };

  const onOpenViewer = (collectionName: string) => {
    const col = (collectionName || "").trim();
    if (!col) {
      setToast({ message: "Нет имени коллекции для просмотра в графе.", variant: "error" });
      return;
    }
    const url = `/graphview?collection=${encodeURIComponent(col)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const filesCounts = useMemo(() => {
    const stats = job?.stats;
    if (!stats) return null;
    const denom = typeof stats.total_files === "number" ? stats.total_files : 0;
    if (denom <= 0) {
      return null;
    }
    const numer = typeof stats.processed_files === "number" ? stats.processed_files : 0;
    return { numer, denom };
  }, [job?.stats]);

  const progressValue = useMemo(() => {
    if (!filesCounts) return null;
    return Math.min(100, Math.round((filesCounts.numer / filesCounts.denom) * 100));
  }, [filesCounts]);

  const embeddingsBar = useMemo(() => {
    const stats = job?.stats;
    if (!stats) return null;
    const denom = typeof stats.vector_chunks === "number" ? stats.vector_chunks : 0;
    const numer = typeof stats.embedded_chunks === "number" ? stats.embedded_chunks : undefined;
    if (denom > 0 && typeof numer === "number") {
      const percent = Math.floor((numer / denom) * 100);
      return {
        percent: Math.min(100, Math.max(0, percent)),
        numer,
        denom,
      };
    }
    return null;
  }, [job?.stats]);

  const graphNodesBar = useMemo(() => {
    const stats = job?.stats;
    if (!stats) return null;
    const denom = typeof stats.graph_nodes_total === "number" ? stats.graph_nodes_total : 0;
    const numer = typeof stats.graph_nodes_written === "number" ? stats.graph_nodes_written : undefined;
    if (denom > 0 && typeof numer === "number") {
      const percent = Math.floor((numer / denom) * 100);
      return {
        percent: Math.min(100, Math.max(0, percent)),
        numer,
        denom,
      };
    }
    return null;
  }, [job?.stats]);

  const graphEdgesBar = useMemo(() => {
    const stats = job?.stats;
    if (!stats) return null;
    const denom = typeof stats.graph_edges_total === "number" ? stats.graph_edges_total : 0;
    const numer = typeof stats.graph_edges_written === "number" ? stats.graph_edges_written : undefined;
    if (denom > 0 && typeof numer === "number") {
      const percent = Math.floor((numer / denom) * 100);
      return {
        percent: Math.min(100, Math.max(0, percent)),
        numer,
        denom,
      };
    }
    return null;
  }, [job?.stats]);

  const sessionSegments = useMemo(() => job?.stats?.session_segments ?? [], [job?.stats?.session_segments]);

  const segmentsAvailable = useMemo(() => {
    if (!sessionSegments.length) return false;
    if (sessionSegments.some((value) => value <= 0)) return false;
    const totalUnits = sessionSegments.reduce((sum, value) => sum + value, 0);
    if (totalUnits <= 0) return false;
    const sessionTotal = job?.stats?.session_total_files ?? 0;
    if (sessionTotal <= 0) return false;
    return true;
  }, [sessionSegments, job?.stats?.session_total_files]);

  const showSpinner = useMemo(() => {
    if (!job) return false;
    if (job.status !== "RUNNING") return false;
    const hasFilesBar = progressValue !== null;
    const hasEmbeddings = !!embeddingsBar;
    const hasGraphNodes = !!graphNodesBar;
    const hasGraphEdges = !!graphEdgesBar;
    return !(hasFilesBar || hasEmbeddings || hasGraphNodes || hasGraphEdges);
  }, [job, progressValue, embeddingsBar, graphNodesBar, graphEdgesBar]);

  return (
    <div className="stack">
      {toast && <Toast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} />}

      <section className="panel stack">
        <h2>Загрузка выгрузки 1С</h2>
        <p className="text-muted">
          Файлы будут сохранены в workspace и поставлены в очередь на обработку индексатором Neo4j/FAISS.
        </p>

        <Input label="Коллекция" value={collection} onChange={(event) => setCollection(event.target.value)} />

        <label className="field">
          <span className="field-label">Файлы (.bsl, .xml, .html, .txt)</span>
          <div className="dropzone">
            <input ref={fileInputRef} type="file" multiple onChange={onFileChange} style={{ display: "none" }} id="file_input" accept=".bsl,.xml,.html,.htm,.txt" />
            <p>Перетащите файлы или нажмите, чтобы выбрать.</p>
            <Button variant="secondary" onClick={() => document.getElementById("file_input")?.click()}>
              Выбрать файлы
            </Button>
          </div>
        </label>

        {files.length > 0 && (
          <div className="card">
            <h3 data-testid="selected-files-count">Выбрано файлов: {files.length}</h3>
          </div>
        )}

        {error && <div className="card status-error">{error}</div>}

        <Button onClick={onSubmit} loading={isUploading} disabled={isUploading}>
          Запустить индексирование
        </Button>
      </section>

      {jobId && (
        <section className="panel stack">
          <header className="inline" style={{ justifyContent: "space-between" }}>
            <div>
              <h2>Статус задачи</h2>
              <p className="text-muted">
                Job ID: <code>{jobId}</code>
              </p>
            </div>
            <StatusPill status={job?.status ?? "PENDING"} />
          </header>

          {filesCounts && (
            <div className="stack" data-testid="indexing-files">
              {segmentsAvailable ? (
                <SegmentedProgressBar
                  valueNumer={filesCounts.numer}
                  valueDenom={filesCounts.denom}
                  segments={sessionSegments}
                  label="Files processed"
                />
              ) : (
                <ProgressBar value={progressValue} label="Files processed" />
              )}
              <div className="inline text-muted" data-testid="indexing-files-count" style={{ gap: "0.25rem" }}>
                <span>{filesCounts.numer}</span>
                <span>/</span>
                <span>{filesCounts.denom}</span>
              </div>
            </div>
          )}

          {embeddingsBar && (
            <div className="stack" data-testid="indexing-embeddings">
              {segmentsAvailable ? (
                <SegmentedProgressBar
                  valueNumer={embeddingsBar.numer}
                  valueDenom={embeddingsBar.denom}
                  segments={sessionSegments}
                  label="Embeddings"
                />
              ) : (
                <ProgressBar value={embeddingsBar.percent} label="Embeddings" />
              )}
              <div className="inline text-muted" data-testid="indexing-embeddings-count" style={{ gap: "0.25rem" }}>
                <span>{embeddingsBar.numer}</span>
                <span>/</span>
                <span>{embeddingsBar.denom}</span>
              </div>
            </div>
          )}

          {graphNodesBar && (
            <div className="stack" data-testid="indexing-graph-nodes">
              {segmentsAvailable ? (
                <SegmentedProgressBar
                  valueNumer={graphNodesBar.numer}
                  valueDenom={graphNodesBar.denom}
                  segments={sessionSegments}
                  label="Graph nodes"
                />
              ) : (
                <ProgressBar value={graphNodesBar.percent} label="Graph nodes" />
              )}
              <div className="inline text-muted" data-testid="indexing-graph-nodes-count" style={{ gap: "0.25rem" }}>
                <span>{graphNodesBar.numer}</span>
                <span>/</span>
                <span>{graphNodesBar.denom}</span>
              </div>
            </div>
          )}

          {graphEdgesBar && (
            <div className="stack" data-testid="indexing-graph-edges">
              {segmentsAvailable ? (
                <SegmentedProgressBar
                  valueNumer={graphEdgesBar.numer}
                  valueDenom={graphEdgesBar.denom}
                  segments={sessionSegments}
                  label="Graph edges"
                />
              ) : (
                <ProgressBar value={graphEdgesBar.percent} label="Graph edges" />
              )}
              <div className="inline text-muted" data-testid="indexing-graph-edges-count" style={{ gap: "0.25rem" }}>
                <span>{graphEdgesBar.numer}</span>
                <span>/</span>
                <span>{graphEdgesBar.denom}</span>
              </div>
            </div>
          )}

          <div className="card-grid">
            <StatCard title="Файлы" value={job?.stats.processed_files ?? 0} />
            <StatCard title="Граф: узлы" value={job?.stats.nodes ?? 0} />
            <StatCard title="Граф: связи" value={job?.stats.edges ?? 0} />
            <StatCard title="FAISS чанк" value={job?.stats.vector_chunks ?? 0} />
            <StatCard title="Длительность (сек)" value={(job?.stats.duration_sec ?? 0).toFixed(1)} />
          </div>

          {job?.errors.length ? (
            <div className="card stack">
              <h3>Ошибки</h3>
              <ul className="file-list">
                {job.errors.map((err, idx) => (
                  <li key={`${err.message}-${idx}`}>
                    <span>{err.message}</span>
                    {err.path && <span>{err.path}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : showSpinner ? (
            <div className="inline" style={{ alignItems: "center" }}>
              <Spinner />
              <span>Идет индексирование…</span>
            </div>
          ) : null}
        </section>
      )}

      <section className="panel stack">
        <header className="inline" style={{ justifyContent: "space-between" }}>
          <h2>Недавние задачи</h2>
          <Button variant="secondary" onClick={() => setRecentJobs([])}>
            Очистить список
          </Button>
        </header>

        {recentJobs.length === 0 ? (
          <p className="text-muted">Пока нет сохраненных задач.</p>
        ) : (
          <ul className="file-list">
            {recentJobs.map((item) => (
              <li key={item.jobId}>
                <div>
                  <strong>{item.collection}</strong>
                  <div className="text-muted">{new Date(item.updatedAt).toISOString().replace("T", " ").slice(0, 19)}</div>
                </div>
                <div className="inline" style={{ alignItems: "center", gap: "0.5rem" }}>
                  <StatusPill status={item.status} />
                  <Button variant="secondary" onClick={() => onOpenViewer(item.collection)}>
                    Открыть
                  </Button>
                  <Button variant="secondary" onClick={() => onSelectJob(item.jobId)}>
                    Статус
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: JobStatus }) {
  const label = {
    PENDING: "Ожидает",
    RUNNING: "Идет",
    DONE: "Готово",
    ERROR: "Ошибка",
  }[status];
  return <span className={`status-pill status-${status.toLowerCase()}`}>{label}</span>;
}

function StatCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="card">
      <h4 style={{ margin: "0 0 0.25rem" }}>{title}</h4>
      <strong style={{ fontSize: "1.3rem" }}>{value}</strong>
    </div>
  );
}

function loadRecentJobs(): RecentJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as RecentJob[]) : [];
  } catch {
    return [];
  }
}

function saveRecentJobs(jobs: RecentJob[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(jobs));
  } catch {
    // ignore quota errors
  }
}
