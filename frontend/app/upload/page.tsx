"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ProgressBar } from "@/components/ui/ProgressBar";
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
    if (!collection.trim()) {
      setError("Укажите коллекцию.");
      return;
    }
    if (!files.length) {
      setError("Выберите хотя бы один файл.");
      return;
    }
    const formData = new FormData();
    formData.append("collection", collection.trim());
    files.forEach((file) => {
      const rel = (file as any).webkitRelativePath || file.name;
      // pass relative path as the third argument to preserve folder structure on server
      formData.append("files", file, rel);
    });
    setIsUploading(true);
    const response = await apiRequest<{ job_id: string }>({
      path: "/upload",
      method: "POST",
      body: formData,
    });
    setIsUploading(false);
    if (!response.ok || !response.data) {
      setToast({ message: response.error ?? "Не удалось создать задачу.", variant: "error" });
      return;
    }
    setJob(null);
    setJobId(response.data.job_id);
    setToast({ message: "Задача создана, начато индексирование.", variant: "success" });
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

  const progressValue = useMemo(() => {
    if (!job || !job.stats || (job.stats.total_files ?? 0) <= 0) return null;
    return Math.min(100, Math.round((job.stats.processed_files / job.stats.total_files) * 100));
  }, [job?.stats?.processed_files, job?.stats?.total_files, job]);

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

  const showSpinner = useMemo(() => {
    const hasFilesBar = progressValue !== null;
    const hasEmbeddings = !!embeddingsBar;
    const hasGraphNodes = !!graphNodesBar;
    const hasGraphEdges = !!graphEdgesBar;
    const hasAnyBar = hasFilesBar || hasEmbeddings || hasGraphNodes || hasGraphEdges;
    return job && job.status === "RUNNING" && !hasAnyBar;
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

          {progressValue !== null && (
            <div className="stack" data-testid="job-progress">
              <ProgressBar value={progressValue} label="Files processed" />
              <div className="inline text-muted" data-testid="job-progress-count" style={{ gap: "0.25rem" }}>
                <span>{job?.stats.processed_files ?? 0}</span>
                <span>/</span>
                <span>{job?.stats.total_files ?? 0}</span>
              </div>
            </div>
          )}

          {embeddingsBar && (
            <div className="stack" data-testid="indexing-embeddings">
              <ProgressBar value={embeddingsBar.percent} label="Embeddings" />
              <div className="inline text-muted" data-testid="indexing-embeddings-count" style={{ gap: "0.25rem" }}>
                <span>{embeddingsBar.numer}</span>
                <span>/</span>
                <span>{embeddingsBar.denom}</span>
              </div>
            </div>
          )}

          {graphNodesBar && (
            <div className="stack" data-testid="indexing-graph-nodes">
              <ProgressBar value={graphNodesBar.percent} label="Graph nodes" />
              <div className="inline text-muted" data-testid="indexing-graph-nodes-count" style={{ gap: "0.25rem" }}>
                <span>{graphNodesBar.numer}</span>
                <span>/</span>
                <span>{graphNodesBar.denom}</span>
              </div>
            </div>
          )}

          {graphEdgesBar && (
            <div className="stack" data-testid="indexing-graph-edges">
              <ProgressBar value={graphEdgesBar.percent} label="Graph edges" />
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
