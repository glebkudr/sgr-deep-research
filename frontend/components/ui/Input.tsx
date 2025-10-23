"use client";

import classNames from "classnames";
import { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

export function Input({ label, error, className, ...rest }: InputProps) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <input className={classNames("field-input", className, { "field-error": Boolean(error) })} {...rest} />
      {error && <span className="field-hint">{error}</span>}
    </label>
  );
}
