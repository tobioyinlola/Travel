import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export type Labels = Record<string, string>;
export interface Sample {
  value: number;
  labels?: Labels;
}
interface Gauge {
  name: string;
  help: string;
  collect: () => Promise<Sample[] | number>;
}

const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const fmt = (labels?: Labels) =>
  labels && Object.keys(labels).length
    ? `{${Object.entries(labels)
        .map(([k, v]) => `${k}="${esc(v)}"`)
        .join(',')}}`
    : '';

/**
 * Prometheus text exposition for the service-level indicators in ARCH ("SLOs and alerts"). Modules register gauges
 * that read their own tables under their own role; the platform only renders them, so it never needs to know about
 * bookings or ledgers. HTTP request counts and latency are kept in memory per process.
 */
@Injectable()
export class MetricsRegistry {
  private readonly gauges: Gauge[] = [];
  private readonly requests = new Map<string, number>();
  private readonly latency = new Map<string, { counts: number[]; sum: number; n: number }>();

  /** `collect` returns one number, or labelled samples. A failing collector reports itself instead of breaking the page. */
  gauge(name: string, help: string, collect: () => Promise<Sample[] | number>): void {
    if (this.gauges.some((g) => g.name === name)) throw new Error(`Duplicate metric ${name}`);
    this.gauges.push({ name, help, collect });
  }

  /** Express middleware recording count and latency by route template (never by raw URL, so tokens stay out). */
  middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const route = (req.route?.path as string | undefined) ?? 'unmatched';
        const base = `${req.method}|${route}`;
        const code = `${base}|${res.statusCode}`;
        this.requests.set(code, (this.requests.get(code) ?? 0) + 1);
        const secs = Number(process.hrtime.bigint() - start) / 1e9;
        const h = this.latency.get(base) ?? { counts: BUCKETS.map(() => 0), sum: 0, n: 0 };
        BUCKETS.forEach((b, i) => {
          if (secs <= b) h.counts[i]! += 1;
        });
        h.sum += secs;
        h.n += 1;
        this.latency.set(base, h);
      });
      next();
    };
  }

  async render(): Promise<string> {
    const out: string[] = [];
    for (const g of this.gauges) {
      out.push(`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`);
      try {
        const r = await g.collect();
        const samples = typeof r === 'number' ? [{ value: r }] : r;
        for (const s of samples) out.push(`${g.name}${fmt(s.labels)} ${s.value}`);
      } catch {
        out.push(`${g.name}_collect_error 1`);
      }
    }
    out.push(
      '# HELP http_requests_total HTTP requests by method, route template and status.',
      '# TYPE http_requests_total counter',
    );
    for (const [k, v] of this.requests) {
      const [method, route, status] = k.split('|');
      out.push(
        `http_requests_total${fmt({ method: method!, route: route!, status: status! })} ${v}`,
      );
    }
    out.push(
      '# HELP http_request_duration_seconds HTTP request latency.',
      '# TYPE http_request_duration_seconds histogram',
    );
    for (const [k, h] of this.latency) {
      const [method, route] = k.split('|');
      const l = { method: method!, route: route! };
      BUCKETS.forEach((b, i) =>
        out.push(
          `http_request_duration_seconds_bucket${fmt({ ...l, le: String(b) })} ${h.counts[i]}`,
        ),
      );
      out.push(`http_request_duration_seconds_bucket${fmt({ ...l, le: '+Inf' })} ${h.n}`);
      out.push(
        `http_request_duration_seconds_sum${fmt(l)} ${h.sum}`,
        `http_request_duration_seconds_count${fmt(l)} ${h.n}`,
      );
    }
    return `${out.join('\n')}\n`;
  }
}
