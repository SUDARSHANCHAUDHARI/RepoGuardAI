# Authentication & Authorization Review

Authentication:

- How are users identified? (session cookie, JWT, API key, OAuth.)
- Are credentials verified server-side on every protected route?
- Password storage: strong salted hash (bcrypt/scrypt/argon2)? No plaintext,
  no fast hashes.
- Session/token lifetime, rotation, revocation, and invalidation on logout.
- JWT: signature verified? `alg` pinned (no `none`)? secret strength? expiry?
- MFA/OTP flows: replay protection, expiry, single-use, rate limiting.
- Account recovery: token entropy, expiry, single-use, no user enumeration.

Authorization:

- Is there a consistent permission model, or ad-hoc checks per route?
- Are checks enforced server-side (never trust the client)?
- Role/permission checks on every state-changing and data-reading route.
- Object-level authorization (ownership) — the fix for IDOR.
- Tenant isolation in multi-tenant systems.
- Admin routes gated by admin checks, not just authentication.
- No privilege escalation via mass-assignment of role/permission fields.

For each finding, quote the code that establishes or fails to establish the
control, with `file:line`. Distinguish "authenticated" from "authorized" —
they are different failures.
