'use client';

import { Check, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ICON, IconButton } from './ui';

export interface FilterDef {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

/**
 * The reference toolbar: round search and filter buttons, then the primary action. Opening filters shows
 * pill chips; while open the filter button becomes a dark pill with confirm and clear.
 */
export function FilterBar({
  filters,
  values,
  onChange,
  search,
  onSearch,
  searchLabel = 'Search',
  children,
}: {
  filters: FilterDef[];
  values: Record<string, string | undefined>;
  onChange: (values: Record<string, string | undefined>) => void;
  search?: string | undefined;
  onSearch?: (q: string | undefined) => void;
  searchLabel?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(Object.values(values).some(Boolean));
  const [searching, setSearching] = useState(Boolean(search));
  const [draft, setDraft] = useState(values);
  const [q, setQ] = useState(search ?? '');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(values), [values]);
  useEffect(() => {
    if (searching) input.current?.focus();
  }, [searching]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onSearch &&
        (searching ? (
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              onSearch(q.trim() || undefined);
            }}
            className="flex h-12 items-center gap-2 rounded-full bg-surface pl-4 pr-1"
          >
            <Search {...ICON} aria-hidden />
            <label className="sr-only" htmlFor="filterbar-q">
              {searchLabel}
            </label>
            <input
              id="filterbar-q"
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchLabel}
              className="w-44 bg-transparent text-sm outline-none placeholder:text-faint"
            />
            <button
              type="button"
              aria-label="Close search"
              onClick={() => {
                setSearching(false);
                setQ('');
                onSearch(undefined);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas"
            >
              <X {...ICON} size={16} aria-hidden />
            </button>
          </form>
        ) : (
          <IconButton icon={Search} label={searchLabel} onClick={() => setSearching(true)} />
        ))}

      {filters.length > 0 &&
        (open ? (
          <div className="flex h-12 items-center gap-1 rounded-full bg-ink p-1 text-white">
            <span className="flex h-10 w-10 items-center justify-center">
              <SlidersHorizontal {...ICON} aria-hidden />
            </span>
            <button
              type="button"
              aria-label="Apply filters"
              onClick={() => onChange(draft)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <Check {...ICON} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Clear filters"
              onClick={() => {
                const cleared = Object.fromEntries(filters.map((f) => [f.key, undefined]));
                setDraft(cleared);
                onChange(cleared);
                setOpen(false);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <X {...ICON} aria-hidden />
            </button>
          </div>
        ) : (
          <IconButton icon={SlidersHorizontal} label="Filters" onClick={() => setOpen(true)} />
        ))}

      {open &&
        filters.map((f) => {
          const v = draft[f.key];
          return (
            <label
              key={f.key}
              className={`relative inline-flex h-12 items-center rounded-full px-5 text-sm ${v ? 'bg-surface text-ink ring-1 ring-ink' : 'bg-surface text-muted'}`}
            >
              <span className="sr-only">{f.label}</span>
              <select
                value={v ?? ''}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value || undefined })}
                className="cursor-pointer appearance-none bg-transparent pr-1 outline-none"
              >
                <option value="">{f.label}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      {children}
    </div>
  );
}
