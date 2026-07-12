# Functional Bug Review

Find defects that cause incorrect behaviour, crashes, or data corruption.

Look for:

- Null/undefined dereferences and unchecked optionals.
- Off-by-one and boundary errors.
- Incorrect error handling (swallowed errors, wrong error mapping, missing
  `await`, unhandled promise rejections).
- Race conditions and shared mutable state.
- Resource leaks (unclosed files, sockets, DB connections).
- Incorrect conditionals / inverted logic.
- Type coercion and serialization mismatches.
- State that can desync between UI and source of truth.
- Incorrect pagination, sorting, or filtering logic.
- Money/time/timezone/rounding mistakes.

For every candidate:

1. Open the file and read the surrounding context.
2. State the exact trigger condition that produces the bug.
3. Quote the offending code as evidence with `file:line`.
4. Describe the impact.

Do not report a bug as `confirmed` unless you can point to the code path that
produces it. If it depends on runtime data you cannot see, mark it
`manual-verification`.
