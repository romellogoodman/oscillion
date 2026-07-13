import * as React from "react";

import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";

import { MAX_INKS, RISO_INKS } from "./oscillon-engine";

/*
  Ink drum picker: an ordered multi-select over the 34 Risolve wheel
  inks. Click adds an ink as the next drum (badge shows drum order),
  click again removes it. Value model: readonly number[] of ink
  indices, order = drum order = filter-wheel time order.

  Custom because no built-in owns an ordered bounded multi-select over
  a fixed swatch set — see the builtInFitCheck in app-acceptance.ts.
*/

export function InkDrumsControl({
  setValue,
  value,
}: ToolcraftCustomControlRendererProps): React.JSX.Element {
  const selection: number[] = Array.isArray(value)
    ? (value as unknown[])
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0 && v < RISO_INKS.length)
    : [];

  const toggle = (idx: number) => {
    const next = selection.includes(idx)
      ? selection.filter((v) => v !== idx)
      : selection.length < MAX_INKS
        ? [...selection, idx]
        : selection;
    if (next.length !== selection.length) setValue(next);
  };

  return (
    <div
      className="grid grid-cols-9 gap-2"
      data-testid="oscillon-ink-drums"
      role="group"
    >
      {RISO_INKS.map((ink, idx) => {
        const order = selection.indexOf(idx);
        const selected = order >= 0;
        return (
          <button
            aria-label={`${ink.name}${selected ? `, drum ${order + 1}` : ""}`}
            aria-pressed={selected}
            className="relative size-5 cursor-pointer rounded-full border border-[color:color-mix(in_oklab,var(--border)_60%,transparent)] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--link)]"
            data-ink-index={idx}
            data-selected={selected ? "true" : undefined}
            key={ink.name}
            onClick={() => toggle(idx)}
            style={{ backgroundColor: ink.hex }}
            title={ink.name}
            type="button"
          >
            {selected ? (
              <span
                aria-hidden="true"
                className="absolute -top-1.5 -right-1.5 flex size-3.5 items-center justify-center rounded-full bg-[color:var(--foreground)] text-[9px] leading-none font-medium text-[color:var(--background)]"
              >
                {order + 1}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
