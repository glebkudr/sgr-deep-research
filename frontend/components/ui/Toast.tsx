"use client";

import classNames from "classnames";

type ToastProps = {
  message: string;
  variant?: "info" | "error" | "success";
  onClose?: () => void;
};

export function Toast({ message, variant = "info", onClose }: ToastProps) {
  return (
    <div className={classNames("toast", `toast-${variant}`)}>
      <span>{message}</span>
      {onClose && (
        <button className="toast-close" onClick={onClose} aria-label="Close notification">
          ×
        </button>
      )}
    </div>
  );
}
