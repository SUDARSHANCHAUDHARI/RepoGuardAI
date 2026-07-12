# Repository Discovery

Goal: build an accurate mental model of the repository before reviewing anything.

Do:

1. Identify programming languages, frameworks, and package managers.
2. Locate dependency manifests and lockfiles.
3. Identify API frameworks and where routes/handlers are defined.
4. Identify authentication/authorization code.
5. Identify configuration and environment files.
6. Identify test frameworks and where tests live.
7. Identify CI/CD workflows and Docker/infrastructure files.

RepoGuard has already produced `.repoguard/discovery.json`. Treat it as a
starting map, not ground truth. Confirm anything you rely on by opening the
actual file and line.

Rules:

- Do not assume a file's purpose from its name — open it.
- Do not fabricate paths, endpoints, or line numbers.
- If the stack is unfamiliar or unsupported, say so explicitly and continue
  with a manual read.

Output: a short inventory of the components you will review, each with a real
file path you have opened.
