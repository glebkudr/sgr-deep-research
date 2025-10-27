"use client";

type SegmentedProgressBarProps = {
  label?: string;
  valueNumer: number;
  valueDenom: number;
  segments: number[];
};

type SegmentDescriptor = {
  key: number;
  widthRatio: number;
  fillRatio: number;
  segmentUnits: number;
};

export function SegmentedProgressBar({ label, valueNumer, valueDenom, segments }: SegmentedProgressBarProps) {
  if (valueDenom <= 0) {
    throw new Error("SegmentedProgressBar requires a positive denominator.");
  }
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("SegmentedProgressBar requires at least one segment.");
  }
  if (segments.some((segment) => segment <= 0)) {
    throw new Error("SegmentedProgressBar segments must be positive integers.");
  }

  const totalUnits = segments.reduce((sum, segment) => sum + segment, 0);
  if (totalUnits <= 0) {
    throw new Error("SegmentedProgressBar computed invalid total weight.");
  }

  const clampedValue = Math.max(0, Math.min(valueDenom, valueNumer));
  const overallProgress = Math.min(1, clampedValue / valueDenom);

  let cursor = 0;
  const descriptors: SegmentDescriptor[] = segments.map((segment, index) => {
    const widthRatio = segment / totalUnits;
    const start = cursor;
    const end = start + widthRatio;
    cursor = end;

    let fillRatio = 0;
    if (overallProgress >= end) {
      fillRatio = 1;
    } else if (overallProgress > start) {
      fillRatio = (overallProgress - start) / widthRatio;
    }

    return {
      key: index,
      widthRatio,
      fillRatio: Math.max(0, Math.min(1, fillRatio)),
      segmentUnits: segment,
    };
  });

  return (
    <div className="progress" data-testid="segmented-progress">
      {label && <span className="progress-label">{label}</span>}
      <div
        className="progress-track segmented-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={valueDenom}
        aria-valuenow={clampedValue}
      >
        {descriptors.map(({ key, widthRatio, fillRatio, segmentUnits }) => (
          <div
            key={key}
            className="segmented-progress-segment"
            style={{ flexGrow: segmentUnits, flexBasis: 0 }}
            data-testid={`segmented-progress-segment-${key}`}
          >
            <div className="segmented-progress-segment-fill" style={{ width: `${fillRatio * 100}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
