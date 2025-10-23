"use client";

type ProgressBarProps = {
  value: number | null;
  label?: string;
};

export function ProgressBar({ value, label }: ProgressBarProps) {
  const clamped = typeof value === "number" ? Math.min(100, Math.max(0, value)) : null;
  return (
    <div className="progress">
      {label && <span className="progress-label">{label}</span>}
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: clamped !== null ? `${clamped}%` : "100%" }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
