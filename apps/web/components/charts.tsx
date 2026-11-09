'use client';

/**
 * Charts in the reference style: hatched bars with the latest value highlighted in blue, and a line with a
 * hatched area. Plain SVG, no chart library. Each chart has a text alternative.
 */
import { useId } from 'react';

export function BarChart({
  data,
  label,
}: {
  data: Array<{ label: string; value: number }>;
  label: string;
}) {
  const id = useId();
  const max = Math.max(1, ...data.map((d) => d.value));
  const last = data.length - 1;
  return (
    <figure>
      <svg
        viewBox={`0 0 ${data.length * 44} 170`}
        className="h-40 w-full"
        role="img"
        aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}
      >
        <defs>
          <pattern
            id={`${id}-hatch`}
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <rect width="2" height="7" fill="#d9d9d9" />
          </pattern>
          <pattern
            id={`${id}-hatch-blue`}
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <rect width="7" height="7" fill="#cfe5ff" />
            <rect width="2" height="7" fill="#1e8bff" />
          </pattern>
          <linearGradient id={`${id}-fade`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ececec" />
            <stop offset="1" stopColor="#ffffff" />
          </linearGradient>
        </defs>
        {data.map((d, i) => {
          const h = Math.max(6, (d.value / max) * 96);
          const x = i * 44 + 8;
          const y = 136 - h;
          return (
            <g key={d.label}>
              <rect
                x={x}
                y={y}
                width="28"
                height={h}
                rx="10"
                fill={i === last ? `url(#${id}-hatch-blue)` : `url(#${id}-fade)`}
              />
              {i !== last && (
                <rect
                  x={x}
                  y={y}
                  width="28"
                  height={h}
                  rx="10"
                  fill={`url(#${id}-hatch)`}
                  opacity="0.5"
                />
              )}
              {i === last && (
                <g>
                  <rect x={x - 2} y={y - 24} width="32" height="18" rx="9" fill="#1e8bff" />
                  <text x={x + 14} y={y - 11.5} textAnchor="middle" fontSize="11" fill="#fff">
                    {d.value}
                  </text>
                </g>
              )}
              <text x={x + 14} y="160" textAnchor="middle" fontSize="11" fill="#6e6e6e">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function AreaChart({
  data,
  label,
}: {
  data: Array<{ label: string; value: number }>;
  label: string;
}) {
  const id = useId();
  const w = 320;
  const h = 120;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((d, i) => [i * step, 12 + (1 - d.value / max) * (h - 30)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <figure>
      <svg
        viewBox={`0 0 ${w} ${h + 18}`}
        className="h-36 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}
      >
        <defs>
          <pattern
            id={`${id}-h`}
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <rect width="7" height="7" fill="#eaf4ff" />
            <rect width="2" height="7" fill="#9ccaff" />
          </pattern>
        </defs>
        <path d={area} fill={`url(#${id}-h)`} />
        <path
          d={line}
          fill="none"
          stroke="#1e8bff"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3" fill="#1e8bff" />
        ))}
        {data.map((d, i) => (
          <text
            key={d.label}
            x={i * step}
            y={h + 14}
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
            fontSize="10"
            fill="#6e6e6e"
          >
            {d.label}
          </text>
        ))}
      </svg>
    </figure>
  );
}

/** Ranked list with hatched progress bars ("Top destinations"). */
export function RankList({
  items,
}: {
  items: Array<{ key: string; label: React.ReactNode; value: number; caption: string }>;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <ol className="flex flex-col gap-3">
      {items.map((it, idx) => (
        <li
          key={it.key}
          className="grid grid-cols-[20px_minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm"
        >
          <span className="text-muted">{String(idx + 1).padStart(2, '0')}</span>
          <span className="truncate">{it.label}</span>
          <span className="relative h-5 overflow-hidden rounded-full hatch" aria-hidden>
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-accent"
              style={{ width: `${Math.max(12, (it.value / max) * 60)}%` }}
            />
          </span>
          <span className="whitespace-nowrap text-muted">
            {it.caption}{' '}
            <span className="ml-1 text-ink">{Math.round((it.value / total) * 100)}%</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
