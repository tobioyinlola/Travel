'use client';

import Link from 'next/link';
import { ArrowUpRight, ChevronRight, type LucideIcon } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { useId } from 'react';

/** Line icons at the reference weight. */
export const ICON = { size: 20, strokeWidth: 1.5 } as const;

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------------------------- surfaces

export function Card({
  title,
  action,
  children,
  className = '',
  tone = 'surface',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: 'surface' | 'canvas';
}) {
  return (
    <section
      className={cx(
        'rounded-[var(--radius-card)] p-6',
        tone === 'surface' ? 'bg-surface' : 'bg-canvas',
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          {title && <h2 className="text-sm font-medium text-muted">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-normal tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- buttons

type Variant = 'primary' | 'secondary' | 'dark' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-strong text-white hover:bg-accent-deep',
  secondary: 'bg-surface text-ink hover:bg-white/70 ring-1 ring-line',
  dark: 'bg-ink text-white hover:bg-black',
  danger: 'bg-danger text-white hover:bg-red-800',
  ghost: 'bg-transparent text-ink hover:bg-surface',
};

export function Button({
  variant = 'primary',
  icon: Icon,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: LucideIcon }) {
  return (
    <button
      className={cx(
        'inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {Icon && <Icon {...ICON} aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'primary',
  icon: Icon,
  children,
  className = '',
}: {
  href: string;
  variant?: Variant;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-medium transition-colors',
        VARIANTS[variant],
        className,
      )}
    >
      {Icon && <Icon {...ICON} aria-hidden />}
      {children}
    </Link>
  );
}

/** Round icon button: white on the canvas, dark when active. Always labelled for screen readers. */
export function IconButton({
  icon: Icon,
  label,
  active = false,
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50',
        size === 'md' ? 'h-12 w-12' : 'h-10 w-10',
        active ? 'bg-ink text-white' : 'bg-surface text-ink hover:bg-white/70',
        className,
      )}
      {...props}
    >
      <Icon {...ICON} aria-hidden />
    </button>
  );
}

export function IconLink({
  href,
  icon: Icon,
  label,
  active = false,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'inline-flex h-12 w-12 items-center justify-center rounded-full transition-colors',
        active ? 'bg-ink text-white' : 'bg-surface text-ink hover:bg-white/70',
      )}
    >
      <Icon {...ICON} aria-hidden />
    </Link>
  );
}

/** The small round arrow in the corner of stat cards. */
export function ArrowLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-canvas text-ink hover:bg-line"
    >
      <ArrowUpRight {...ICON} aria-hidden />
    </Link>
  );
}

// ---------------------------------------------------------------------------------------------- forms

const INPUT =
  'h-12 w-full rounded-[var(--radius-tile)] bg-canvas px-4 text-[15px] text-ink placeholder:text-faint outline-none ' +
  'focus:ring-2 focus:ring-accent aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger';

export function Field({
  label,
  error,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | undefined;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={INPUT}
        {...props}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  label,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLTextAreaElement> & { label: string; rows?: number }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <textarea id={id} className={cx(INPUT, 'h-auto min-h-24 py-3')} {...(props as object)} />
    </div>
  );
}

export function Select({
  label,
  children,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <select
        id={id}
        className={cx(
          INPUT,
          'appearance-none bg-[length:16px] bg-[right_1rem_center] bg-no-repeat pr-10',
        )}
        style={{ backgroundImage: CHEVRON }}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23333' stroke-width='1.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

/** Pill toggle group (e.g. Email / Phone). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex gap-1 rounded-full bg-canvas p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-10 rounded-full px-5 text-sm font-medium',
            value === o.value ? 'bg-ink text-white' : 'text-ink hover:bg-surface',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- feedback

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info' | 'success';
  children: ReactNode;
}) {
  const styles = {
    error: 'bg-danger-soft text-danger',
    info: 'bg-accent-soft text-accent-deep',
    success: 'bg-success-soft text-success',
  }[kind];
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cx('rounded-[var(--radius-tile)] px-4 py-3 text-sm', styles)}
    >
      {children}
    </div>
  );
}

const STATUS: Record<
  string,
  { label?: string; tone: 'blue' | 'green' | 'grey' | 'red' | 'amber' }
> = {
  passed: { tone: 'green' },
  signed: { tone: 'green' },
  active: { tone: 'green' },
  approved: { tone: 'green' },
  paid: { tone: 'green' },
  completed: { tone: 'grey' },
  failed: { tone: 'red' },
  declined: { tone: 'red' },
  rejected: { tone: 'red' },
  cancelled: { tone: 'grey' },
  inactive: { tone: 'grey' },
  under_review: { tone: 'amber', label: 'Under review' },
  changes_requested: { tone: 'amber', label: 'Changes requested' },
  pending: { tone: 'amber' },
  open: { tone: 'amber' },
  sent: { tone: 'amber' },
  requested: { tone: 'amber' },
  planning: { tone: 'grey' },
  proposed: { tone: 'blue' },
  published: { tone: 'blue' },
  upcoming: { tone: 'blue' },
  in_progress: { tone: 'blue', label: 'In progress' },
  superseded: { tone: 'grey' },
  verified: { tone: 'blue' },
  draft: { tone: 'grey' },
  confirmed: { tone: 'green' },
  booked: { tone: 'green' },
  modified: { tone: 'amber' },
  reversed: { tone: 'grey' },
  awaiting: { tone: 'amber', label: 'Awaiting payment' },
  captured: { tone: 'green', label: 'Paid' },
  refunded: { tone: 'grey' },
  partially_refunded: { tone: 'grey', label: 'Partly refunded' },
};

const TONES = {
  blue: 'bg-accent-soft text-accent-deep',
  green: 'bg-success-soft text-success',
  grey: 'bg-canvas text-muted',
  red: 'bg-danger-soft text-danger',
  amber: 'bg-warn-soft text-warn',
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: 'grey' as const };
  const label = s.label ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium',
        TONES[s.tone],
      )}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------- data display

/** KPI tile: small label, large light number, caption and an optional arrow link. */
export function StatCard({
  label,
  value,
  caption,
  href,
  className = '',
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  href?: string;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col justify-between gap-3 rounded-[var(--radius-card)] bg-surface p-5',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        {href && <ArrowLink href={href} label={`Open ${label.toLowerCase()}`} />}
      </div>
      <div>
        <p className="text-4xl font-light tracking-tight">{value}</p>
        {caption && <p className="mt-1 text-xs text-muted">{caption}</p>}
      </div>
    </div>
  );
}

/** Icon tile + title + subtitle + chevron. The core list row of the reference. */
export function ListRow({
  icon: Icon,
  leading,
  title,
  subtitle,
  href,
  onClick,
  trailing,
  tone = 'surface',
}: {
  icon?: LucideIcon;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  /** 'canvas' for rows inside a white card. */
  tone?: 'surface' | 'canvas';
}) {
  const body = (
    <>
      {leading ??
        (Icon && (
          <span
            className={cx(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-ink',
              tone === 'canvas' ? 'bg-surface' : 'bg-canvas',
            )}
          >
            <Icon {...ICON} aria-hidden />
          </span>
        ))}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px]">{title}</span>
        {subtitle && <span className="block truncate text-sm text-muted">{subtitle}</span>}
      </span>
      {trailing ??
        ((href || onClick) && <ChevronRight {...ICON} className="shrink-0 text-ink" aria-hidden />)}
    </>
  );
  const cls = cx(
    'flex w-full items-center gap-4 rounded-[20px] p-2.5 pr-4 text-left',
    tone === 'canvas' ? 'bg-canvas' : 'bg-surface',
  );
  if (href)
    return (
      <Link href={href} className={cx(cls, 'hover:ring-1 hover:ring-line')}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cx(cls, 'hover:ring-1 hover:ring-line')}>
        {body}
      </button>
    );
  return <div className={cls}>{body}</div>;
}

export function Avatar({
  name,
  size = 'md',
  decorative = true,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  decorative?: boolean;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?';
  const s = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-base' }[size];
  return (
    <span
      aria-hidden={decorative || undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-medium text-accent-deep',
        s,
      )}
    >
      {initials}
    </span>
  );
}

/** Flag from an ISO 3166 alpha-2 code (Unicode regional indicators; no image assets). */
export function Flag({ code, className = '' }: { code: string; className?: string }) {
  const flag = code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
  return (
    <span role="img" aria-label={code.toUpperCase()} className={className}>
      {flag}
    </span>
  );
}

/** Label above, value below: the key/value pattern used across detail screens. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-lg">{children}</p>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[20px] bg-surface px-5 py-8 text-center text-sm text-muted">{children}</p>
  );
}
