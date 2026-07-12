# Rate-Limiting Review

Determine whether rate limiting / abuse protection exists where it matters, and
whether it can be bypassed.

Sensitive operations that should be limited:

- Login, registration, password reset.
- OTP generation and verification, email verification.
- Token/API-key creation.
- File uploads.
- Search, exports, reports.
- Webhooks.
- GraphQL queries.
- AI/LLM endpoints.
- Expensive database operations (aggregations, full scans).
- Public APIs and admin APIs.

For each, confirm by opening the route whether a limiter is applied, at what
scope (IP / user / key / global), and with what threshold.

Bypass risks to check:

- Trusting `X-Forwarded-For` or other client-supplied proxy headers for the
  client identity.
- Untrusted proxy chains.
- IPv6 address rotation (limiting on /128 instead of a prefix).
- Rotating across multiple API keys or accounts.
- Alternate routes to the same handler.
- Route case/slash/encoding differences bypassing path-based limits.
- Distributed deployments using in-memory counters (per-instance, not shared).
- GraphQL query batching (many operations in one request).
- WebSocket messages bypassing HTTP-layer limits.
- Frontend-only throttling with no server enforcement.

Report each gap with the endpoint, the missing/insufficient control, the bypass
vector if any, and a recommended limiter (scope + threshold + storage).
