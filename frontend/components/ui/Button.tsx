"use client";

import classNames from "classnames";
import { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  loading?: boolean;
};

export function Button({ className, variant = "primary", loading, children, ...rest }: ButtonProps) {
  return (
    <button
      className={classNames(
        "btn",
        {
          "btn-primary": variant === "primary",
          "btn-secondary": variant === "secondary",
          "btn-loading": loading,
        },
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
