import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { useId } from 'react';

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-surface p-5">
      {title && <h2 className="mb-3 text-lg font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    secondary: 'border border-gray-300 bg-surface text-ink hover:bg-gray-50',
    danger: 'bg-red-700 text-white hover:bg-red-800',
  }[variant];
  return (
    <button
      className={`rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | undefined;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className="rounded-md border border-gray-300 px-3 py-2 aria-[invalid=true]:border-red-700"
        {...props}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} className="rounded-md border border-gray-300 bg-surface px-3 py-2" {...props}>
        {children}
      </select>
    </div>
  );
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info' | 'success';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-red-300 bg-red-50 text-red-900',
    info: 'border-blue-300 bg-blue-50 text-blue-900',
    success: 'border-green-300 bg-green-50 text-green-900',
  }[kind];
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  passed: 'bg-green-100 text-green-900',
  signed: 'bg-green-100 text-green-900',
  active: 'bg-green-100 text-green-900',
  approved: 'bg-green-100 text-green-900',
  paid: 'bg-green-100 text-green-900',
  failed: 'bg-red-100 text-red-900',
  declined: 'bg-red-100 text-red-900',
  rejected: 'bg-red-100 text-red-900',
  under_review: 'bg-amber-100 text-amber-900',
  pending: 'bg-amber-100 text-amber-900',
  open: 'bg-amber-100 text-amber-900',
  sent: 'bg-amber-100 text-amber-900',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-800'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
