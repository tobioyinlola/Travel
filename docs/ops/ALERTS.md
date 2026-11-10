# Alerts and SLOs

Metrics come from `GET /metrics` (bearer token `METRICS_TOKEN`, Prometheus text format). Thresholds follow the ARCH
SLO table. "Page" means wake someone; "ticket" means handle in working hours.

| Alert                   | Expression                                                                                      | For | Action                                      | Runbook                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------- | --- | ------------------------------------------- | -------------------------------------------------------------- |
| Critical jobs are late  | `atp_oldest_due_job_age_seconds{queue="critical"} > 60`                                         | 2m  | Page                                        | [job-backlog](runbooks/job-backlog.md)                         |
| Booking failures high   | `atp_booking_failure_ratio_10m > 0.02`                                                          | 5m  | Page                                        | [supplier-outage](runbooks/supplier-outage.md)                 |
| Bookings stuck          | `atp_bookings_stuck_pending > 0`                                                                | 5m  | Page if > 3, else ticket                    | [stuck-bookings](runbooks/stuck-bookings.md)                   |
| Supplier circuit open   | `atp_supplier_circuit_open == 1`                                                                | 2m  | Ticket (page if booking failures also fire) | [supplier-outage](runbooks/supplier-outage.md)                 |
| Ledger variance         | `atp_ledger_variance_minor != 0`                                                                | 0m  | Page. The target is exactly zero            | [reconciliation-variance](runbooks/reconciliation-variance.md) |
| Webhook backlog         | `atp_webhook_backlog > 20` or `atp_webhook_oldest_unprocessed_age_seconds > 300`                | 5m  | Page                                        | [webhook-backlog](runbooks/webhook-backlog.md)                 |
| Events not delivered    | `atp_outbox_oldest_unrelayed_age_seconds > 120`                                                 | 5m  | Page                                        | [job-backlog](runbooks/job-backlog.md)                         |
| Dead letters            | `atp_dead_letters > 0`                                                                          | 15m | Ticket                                      | [job-backlog](runbooks/job-backlog.md)                         |
| Statement lines waiting | `atp_statement_lines_open > 0`                                                                  | 2d  | Ticket to finance                           | [reconciliation-variance](runbooks/reconciliation-variance.md) |
| API errors              | `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.02` | 5m  | Page                                        | check logs by correlation id                                   |
| Slow API                | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m]))) > 2`    | 10m | Ticket                                      | profile the slowest route                                      |
| Health                  | `GET /v1/health` not 200                                                                        | 1m  | Page                                        | database or Redis down                                         |

Other signals that are logged at error level and should be searched for (no metric yet):
`Chargeback opened`, `Refund ... failed`, `Compensating cancel ... cost`, `Payout ... failed`, `Reconciliation variance`,
`Booking ... has been pending since`.

SLO targets (ARCH): API availability 99.9% monthly; search p95 < 3 s; portal p95 < 2 s; critical jobs start within
60 s; ledger variance 0; RPO 5 min, RTO 1 h (see [restore drill](RESTORE_DRILL.md)).
