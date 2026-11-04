// Small form controls shared by the Planner and the Player.
import { useEffect, useState, type ReactNode } from "react";
import type { Units } from "../shared/types";
import { formatLength, parseLength } from "../shared/units";

export function Section(props: { title: string; children: ReactNode; open?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(props.open ?? true);
  return (
    <section className="section">
      <header onClick={() => setOpen(!open)}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span className="title">{props.title}</span>
        <span className="right" onClick={(e) => e.stopPropagation()}>
          {props.right}
        </span>
      </header>
      {open && <div className="body">{props.children}</div>}
    </section>
  );
}

export function Row(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="row" title={props.hint}>
      <span className="lbl">{props.label}</span>
      <span className="ctl">{props.children}</span>
    </label>
  );
}

/** Length input: shows feet-inches or metres, accepts 12' 6", 12.5, 3.8m, 380cm... */
export function LengthField(props: { value: number; units: Units; onChange: (ft: number) => void; disabled?: boolean; min?: number }) {
  const shown = formatLength(props.value, props.units, { precise: true });
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);
  const commit = () => {
    setEditing(false);
    const v = parseLength(text, props.units);
    if (v === null || (props.min !== undefined && v < props.min)) {
      setBad(true);
      setText(shown);
      setTimeout(() => setBad(false), 1200);
      return;
    }
    setBad(false);
    if (Math.abs(v - props.value) > 1e-9) props.onChange(v);
    else setText(shown);
  };
  return (
    <input
      className={bad ? "len bad" : "len"}
      value={text}
      disabled={props.disabled}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(shown);
          setEditing(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Plain number input that only commits valid numbers. */
export function NumField(props: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  suffix?: string;
  width?: number;
}) {
  const [text, setText] = useState(String(props.value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(round(props.value)));
  }, [props.value, editing]);
  const commit = (t: string) => {
    const v = parseFloat(t);
    if (!isFinite(v)) return;
    const c = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v));
    if (c !== props.value) props.onChange(c);
  };
  return (
    <span className="num">
      <input
        type="number"
        style={props.width ? { width: props.width } : undefined}
        value={text}
        step={props.step ?? 1}
        min={props.min}
        max={props.max}
        disabled={props.disabled}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          commit(text);
        }}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {props.suffix && <span className="suffix">{props.suffix}</span>}
    </span>
  );
}

export function TextField(props: { value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string; width?: number }) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <input
      value={text}
      placeholder={props.placeholder}
      style={props.width ? { width: props.width } : undefined}
      disabled={props.disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== props.value && props.onChange(text)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function Select<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={String(props.value)}
      disabled={props.disabled}
      onChange={(e) => {
        const o = props.options.find((x) => String(x.value) === e.target.value);
        if (o) props.onChange(o.value);
      }}
    >
      {props.options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check(props: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

export const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** True when keyboard focus is in a text box (so hotkeys should not fire). */
export function typingInField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
