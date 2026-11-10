'use client';

import { Calendar, Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ICON } from './ui';

/** ISO date helpers (UTC, `YYYY-MM-DD`). */
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * 86_400_000));
export const formatDay = (s: string) => {
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const start = new Date(first.getTime() - offset * 86_400_000);
  return Array.from({ length: 42 }, (_, i) => iso(new Date(start.getTime() + i * 86_400_000)));
}

/**
 * Date-range picker from the reference: two date pills; the calendar shows the selected range as a dark
 * capsule; while choosing, the calendar button becomes a dark pill with confirm and cancel.
 * Keyboard: arrow keys move, Enter picks, Escape cancels.
 */
export function DateRange({
  start,
  end,
  onChange,
  min,
  max,
  label = 'Travel dates',
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ start: string; end: string | null }>({ start, end });
  const [view, setView] = useState(() => {
    const d = parse(start || iso(new Date()));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  const [focus, setFocus] = useState(start);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft({ start, end });
    setFocus(start);
    const d = parse(start);
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  }, [open, start, end]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const disabled = (d: string) => (min !== undefined && d < min) || (max !== undefined && d > max);

  function pick(d: string) {
    if (disabled(d)) return;
    if (draft.end !== null || d < draft.start) setDraft({ start: d, end: null });
    else setDraft({ start: draft.start, end: d });
    setFocus(d);
  }

  function confirm() {
    const e = draft.end ?? draft.start;
    onChange(draft.start, e);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (e.key in moves) {
      e.preventDefault();
      const next = addDays(focus, moves[e.key]!);
      setFocus(next);
      const d = parse(next);
      setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(focus);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const grid = monthGrid(view.y, view.m);
  const monthName = new Date(Date.UTC(view.y, view.m, 1)).toLocaleDateString('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const rangeEnd = draft.end ?? draft.start;
  const inRange = (d: string) => d >= draft.start && d <= rangeEnd;
  const shownStart = open ? draft.start : start;
  const shownEnd = open ? (draft.end ?? draft.start) : end;

  return (
    <div className="relative" ref={ref}>
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        {open ? (
          <div className="flex h-12 items-center gap-1 rounded-full bg-ink p-1 text-white">
            <span className="flex h-10 w-10 items-center justify-center">
              <Calendar {...ICON} aria-hidden />
            </span>
            <button
              type="button"
              onClick={confirm}
              aria-label="Confirm dates"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <Check {...ICON} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cancel"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <X {...ICON} aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`${label}: change`}
            aria-expanded={open}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-canvas hover:bg-line"
          >
            <Calendar {...ICON} aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-12 rounded-full bg-canvas px-5 text-sm text-muted hover:bg-line"
        >
          <span className="sr-only">Start </span>
          {shownStart ? formatDay(shownStart) : 'Start'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-12 rounded-full bg-canvas px-5 text-sm text-muted hover:bg-line"
        >
          <span className="sr-only">End </span>
          {shownEnd ? formatDay(shownEnd) : 'End'}
        </button>
      </div>
      {open && (
        <div
          role="dialog"
          aria-label={`Choose ${label.toLowerCase()}`}
          className="absolute z-30 mt-3 w-[min(92vw,30rem)] rounded-[28px] bg-surface p-4 shadow-[0_16px_48px_rgba(0,0,0,0.10)] ring-2 ring-canvas"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setView(view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 })
              }
              className="flex h-10 w-20 items-center justify-center rounded-full bg-canvas hover:bg-line"
            >
              <ChevronLeft {...ICON} aria-hidden />
            </button>
            <p className="text-sm font-medium" aria-live="polite">
              {monthName}
            </p>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setView(view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 })
              }
              className="flex h-10 w-20 items-center justify-center rounded-full bg-canvas hover:bg-line"
            >
              <ChevronRight {...ICON} aria-hidden />
            </button>
          </div>
          <div
            className="grid grid-cols-7 gap-y-2"
            role="grid"
            tabIndex={0}
            onKeyDown={onKey}
            aria-label={monthName}
          >
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                role="columnheader"
                className="mx-0.5 flex h-12 items-center justify-center rounded-full bg-canvas text-xs"
              >
                {w}
              </div>
            ))}
            {grid.map((d, i) => {
              const inMonth = parse(d).getUTCMonth() === view.m;
              const sel = inRange(d);
              const col = i % 7;
              const startCap = sel && (d === draft.start || col === 0 || !inRange(addDays(d, -1)));
              const endCap = sel && (d === rangeEnd || col === 6 || !inRange(addDays(d, 1)));
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  aria-selected={sel}
                  aria-label={parse(d).toLocaleDateString('en', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                  disabled={disabled(d)}
                  tabIndex={-1}
                  onClick={() => pick(d)}
                  className={[
                    'flex h-12 items-center justify-center text-sm transition-colors disabled:cursor-not-allowed disabled:text-line',
                    sel
                      ? 'bg-ink text-white'
                      : inMonth
                        ? 'text-ink hover:bg-canvas rounded-full'
                        : 'text-faint',
                    startCap ? 'rounded-l-full' : '',
                    endCap ? 'rounded-r-full' : '',
                    focus === d && !sel ? 'ring-2 ring-accent rounded-full' : '',
                  ].join(' ')}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">
            {draft.end ? 'Press the tick to confirm.' : 'Now choose the last day.'}
          </p>
        </div>
      )}
    </div>
  );
}
