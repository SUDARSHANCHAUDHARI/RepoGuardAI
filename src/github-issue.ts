import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditReportSchema } from "./schemas.js";
import type { Finding } from "./types.js";

export const ISSUE_MARKER = "<!-- repoguard-security-state -->";
export const ISSUE_TITLE =
  "RepoGuardAI: active critical/high security findings";

export interface ExistingSecurityIssue {
  number: number;
  body: string;
}

export type IssueMutation =
  | { kind: "create"; title: string; body: string }
  | { kind: "update"; issueNumber: number; title: string; body: string }
  | { kind: "close"; issueNumber: number }
  | { kind: "noop" };

export interface SyncIssueOptions {
  token: string;
  repository: string;
  reportPath: string;
  runUrl: string;
  apiUrl?: string;
}

interface GitHubIssue {
  number: number;
  body: string | null;
  pull_request?: unknown;
}

export function qualifyingFindings(findings: Finding[]): Finding[] {
  return findings.filter(
    (finding) =>
      finding.status !== "rejected" &&
      (finding.severity === "critical" || finding.severity === "high"),
  );
}

function tableCell(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replaceAll("|", "\\|");
}

function safeRunUrl(value: string): string {
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("RUN_URL must use http or https.");
  }
  return url.toString();
}

export function renderIssueBody(findings: Finding[], runUrl: string): string {
  const rows = findings.map((finding) => {
    const location = finding.file
      ? `${finding.file}${finding.line ? `:${finding.line}` : ""}`
      : "repository-wide";
    return `| ${finding.severity} | ${tableCell(finding.id)} | ${tableCell(finding.title)} | ${tableCell(location)} |`;
  });
  const runLink = safeRunUrl(runUrl);
  return [
    ISSUE_MARKER,
    "## Active RepoGuardAI findings",
    "",
    "| Severity | ID | Finding | Location |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    runLink
      ? `[Open the workflow run for complete evidence and artifacts.](${runLink})`
      : "Open the associated workflow run for complete evidence and artifacts.",
    "",
    "This issue is synchronized automatically. It never includes detected secret values or raw finding evidence.",
  ].join("\n");
}

export function issueMutation(
  findings: Finding[],
  existing: ExistingSecurityIssue | null,
  runUrl = "",
): IssueMutation {
  const active = qualifyingFindings(findings);
  if (active.length === 0) {
    return existing
      ? { kind: "close", issueNumber: existing.number }
      : { kind: "noop" };
  }
  const body = renderIssueBody(active, runUrl);
  return existing
    ? {
        kind: "update",
        issueNumber: existing.number,
        title: ISSUE_TITLE,
        body,
      }
    : { kind: "create", title: ISSUE_TITLE, body };
}

async function githubRequest<T>(
  url: string,
  token: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API ${method} ${response.status}: ${await response.text()}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function syncSecurityIssue(options: SyncIssueOptions): Promise<void> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
    throw new Error("GITHUB_REPOSITORY must use owner/name format.");
  }
  if (!options.token) throw new Error("GITHUB_TOKEN is required.");

  const report = auditReportSchema.parse(
    JSON.parse(readFileSync(options.reportPath, "utf8")) as unknown,
  );
  const apiUrl = (options.apiUrl || "https://api.github.com").replace(/\/$/, "");
  const issueUrl = `${apiUrl}/repos/${options.repository}/issues`;
  const issues = await githubRequest<GitHubIssue[]>(
    `${issueUrl}?state=open&per_page=100`,
    options.token,
  );
  const marked = issues.find(
    (issue) =>
      issue.pull_request === undefined &&
      typeof issue.body === "string" &&
      issue.body.includes(ISSUE_MARKER),
  );
  const existing = marked?.body
    ? { number: marked.number, body: marked.body }
    : null;
  const mutation = issueMutation(report.findings, existing, options.runUrl);

  switch (mutation.kind) {
    case "create":
      await githubRequest(issueUrl, options.token, "POST", {
        title: mutation.title,
        body: mutation.body,
      });
      console.log("✔ Opened RepoGuardAI security issue.");
      return;
    case "update":
      await githubRequest(
        `${issueUrl}/${mutation.issueNumber}`,
        options.token,
        "PATCH",
        { title: mutation.title, body: mutation.body },
      );
      console.log(`✔ Updated RepoGuardAI security issue #${mutation.issueNumber}.`);
      return;
    case "close":
      await githubRequest(
        `${issueUrl}/${mutation.issueNumber}`,
        options.token,
        "PATCH",
        { state: "closed" },
      );
      console.log(`✔ Closed resolved RepoGuardAI security issue #${mutation.issueNumber}.`);
      return;
    case "noop":
      console.log("✔ No critical/high RepoGuardAI issue is needed.");
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntrypoint) {
  syncSecurityIssue({
    token: requiredEnv("GITHUB_TOKEN"),
    repository: requiredEnv("GITHUB_REPOSITORY"),
    reportPath: requiredEnv("REPORT_PATH"),
    runUrl: requiredEnv("RUN_URL"),
    apiUrl: process.env.GITHUB_API_URL,
  }).catch((error: unknown) => {
    console.error(
      `✖ RepoGuardAI issue synchronization failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
