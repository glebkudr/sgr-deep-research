"use client";

import classNames from "classnames";
import { SelectHTMLAttributes } from "react";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: { value: string | number; label: string }[];
};

export function Select({ label, options, className, ...rest }: SelectProps) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <select className={classNames("field-input", className)} {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
