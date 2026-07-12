# API Security Review

For every API endpoint (start from `.repoguard/discovery.json` → `apiEndpoints`,
then confirm by opening each route), check:

- Missing authentication.
- Missing authorization (endpoint authenticated but no permission check).
- IDOR — object references resolved from user input without ownership checks.
- Privilege escalation — role/permission changes reachable by lower roles.
- Missing tenant isolation — cross-tenant data access in multi-tenant apps.
- Injection (SQL/NoSQL/command/template) reachable from the endpoint.
- Unsafe file uploads (type, size, path, executable content).
- Sensitive data exposure in responses.
- CORS misconfiguration (wildcard origin with credentials).
- CSRF on state-changing routes using cookie auth.
- SSRF via server-side fetch of user-supplied URLs.
- Path traversal in file-serving endpoints.
- Insecure/open redirects.
- Weak session or token handling (long-lived tokens, no rotation, no
  revocation, secrets in JWT `alg:none`).
- Missing request validation (schema/type/range).
- Missing request size limits (body/file/array length).
- Missing timeouts on outbound calls.
- Missing pagination limits (unbounded list endpoints).
- Excessive response data (over-fetching, internal fields leaked).
- Information leakage (stack traces, internal IDs, version banners).

Method:

1. For each endpoint, trace: route → middleware → handler → data access.
2. Record which controls are present and which are absent.
3. Quote the code that proves presence/absence.

Produce a per-endpoint table: endpoint, auth?, authz?, validation?, rate limit?,
notes. Feed missing-control endpoints into the final report.
