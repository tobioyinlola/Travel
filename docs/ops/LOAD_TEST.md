# Load test (NFR-01, 02, 03)

Targets: 1,000 concurrent users, 10,000 advisors seeded, search p95 < 3 s, portal p95 < 2 s.

Tooling: `scripts/load-seed.sql` seeds 10,000 advisors, 50,000 clients and 20,000 trips (development databases
only). `scripts/load-test.mjs` runs N virtual users against a weighted mix (live-rate search, clients, trips,
dashboard, insights, health) and prints throughput, errors and p50/p95/p99 per endpoint against the targets. It exits
non-zero when a target is missed, so it can gate a release. `API` may list several instances.

## Result on the development sandbox (4 shared cores: API, worker, web, Postgres, Redis and the load generator)

| Users                      | Total rps | Search p95 | Clients p95 | Trips p95 | Dashboard p95 | Errors |
| -------------------------- | --------- | ---------- | ----------- | --------- | ------------- | ------ |
| 200                        | ~350      | 0.79 s     | 0.42 s      | 0.61 s    | 1.0 s         | 0      |
| 1,000, one API instance    | ~370      | 3.4 s      | 1.8 s       | 2.6 s     | 4.2 s         | 0      |
| 1,000, three API instances | ~450      | 4.1 s      | 2.1 s       | 3.1 s     | 5.1 s         | 0      |

**Reading it honestly.** At 200 users every target is met with wide margin and there are no errors. At 1,000 the box
is saturated (about 370-450 requests per second whatever the user count, so latency grows with concurrency), and
adding API instances on the same four cores barely helps because the cores are the limit. This run therefore does
**not** prove the 1,000-user target; it shows the application is not the bottleneck at realistic per-instance load
and has no errors or leaks under pressure. The real proof needs production-like infrastructure: run the same script
against N API instances on separate hosts with a dedicated database and a separate load generator, starting at
USERS=1000. The API is stateless (sessions in Redis), so it scales horizontally.

Known costs to look at first if the real run misses: the dashboard summary and advisor insights are the heaviest
endpoints (the summary reads every trip of the advisor and aggregates in the application; move it to SQL
aggregates), live search fans out to every supplier (cached 2 minutes per supplier query), and every request opens
a short transaction for row-level security.
