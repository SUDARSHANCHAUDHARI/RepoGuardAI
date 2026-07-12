#!/usr/bin/env bash
#
# claude-deep-pass.sh — validate RepoGuard's deterministic findings with
# Claude Code (headless), on the repos that matter.
#
# For each repo it: refreshes evidence (`repoguard audit .`), runs Claude Code
# non-interactively to validate the seed findings against the real code and
# rewrite repoguard-results/findings.json, then regenerates the reports.
#
# Safety: Claude is given ONLY read + file-write tools (NO Bash, so it cannot
# run shell commands), edits are auto-accepted, and spend is capped per repo.
#
# Usage:
#   ./claude-deep-pass.sh /path/to/repo [/path/to/repo2 ...]
#   ./claude-deep-pass.sh --criticals        # auto-pick repos with >=1 critical
#                                              # from the latest portfolio rollup
# Env:
#   BUDGET=0.75   per-repo USD cap (default 0.75)

set -uo pipefail

ROOT="${REPOGUARD_ROOT:-$HOME/SUDARSHAN_CODE/sudarshan_repos}"
BUDGET="${BUDGET:-0.75}"

command -v claude    >/dev/null 2>&1 || { echo "claude CLI not found"; exit 1; }
command -v repoguard >/dev/null 2>&1 || { echo "repoguard not found";  exit 1; }

# Build repo list.
repos=()
if [ "${1:-}" = "--criticals" ]; then
  rollup="$(ls -t "$ROOT"/repoguard-portfolio-*.md 2>/dev/null | head -1)"
  [ -z "$rollup" ] && { echo "No portfolio rollup found — run portfolio-audit.sh first."; exit 1; }
  echo "Selecting repos with >=1 critical from: $rollup"
  while IFS= read -r line; do
    cat="$(echo "$line"  | awk -F'|' '{gsub(/^ +| +$/,"",$2); print $2}')"
    repo="$(echo "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$3); print $3}')"
    sev="$(echo "$line"  | awk -F'|' '{s=$4; gsub(/[^0-9\/]/,"",s); print s}')"
    crit="${sev%%/*}"
    [ "${crit:-0}" -gt 0 ] 2>/dev/null && [ -d "$ROOT/$cat/$repo" ] && repos+=("$ROOT/$cat/$repo")
  done < <(grep -E '^\| [A-Za-z]' "$rollup" | grep -vE 'Category')
else
  repos=("$@")
fi

[ ${#repos[@]} -eq 0 ] && { echo "No repos to process."; exit 1; }
echo "Deep-pass on ${#repos[@]} repo(s), budget \$$BUDGET each."
echo

PROMPT='Perform a security and code-quality audit of THIS repository (the current working directory).

Read and follow repoguard-results/instructions/claude-instructions.md exactly. It references repoguard-results/evidence.json, which holds deterministic seed findings from automated scanners. Validate EACH seed finding against the actual code by opening the referenced file:line.

Then OVERWRITE repoguard-results/findings.json with your validated findings, using the RepoGuard finding schema (fields: id,title,severity,category,status,confidence,file,line,endpoint,description,evidence,impact,triggerCondition,reproduction,recommendedFix). For every finding set status to exactly one of: confirmed | potential | manual-verification | rejected. Reject scanner false positives explicitly with a one-line reason (e.g. secrets inside vendored/dependency code, or a control that is actually present). Only mark confirmed when you can quote the code at a real file:line. You may add genuine findings the scanners missed.

Do NOT modify any file other than repoguard-results/findings.json. Do not run the application. When done, print a one-line summary: confirmed/potential/manual/rejected counts.'

count_status() { # $1 findings.json, $2 status
  node -e 'try{const f=require(process.argv[1]);console.log(f.findings.filter(x=>x.status===process.argv[2]).length)}catch{console.log(0)}' "$1" "$2" 2>/dev/null || echo 0
}

printf "%-26s %-8s %-38s %s\n" "REPO" "SEED" "AFTER (conf/pot/manual/rej)" "COST/STATUS"
for repo in "${repos[@]}"; do
  name="$(basename "$repo")"
  cd "$repo" || { echo "$name  (cd failed)"; continue; }

  repoguard audit . >/dev/null 2>&1
  seed="$(node -e 'try{console.log(require("./repoguard-results/evidence.json").seedFindings.length)}catch{console.log(0)}' 2>/dev/null)"

  out="repoguard-results/claude-deep-pass.json"
  claude -p "$PROMPT" \
    --allowedTools "Read,Grep,Glob,Write,Edit" \
    --permission-mode acceptEdits \
    --max-budget-usd "$BUDGET" \
    --no-session-persistence \
    --output-format json > "$out" 2>"repoguard-results/claude-deep-pass.err" || true

  cost="$(node -e 'try{const r=require(process.argv[1]);console.log((r.total_cost_usd??r.cost_usd??0).toFixed?"$"+(r.total_cost_usd??r.cost_usd??0).toFixed(3):"?")}catch{console.log("?")}' "$out" 2>/dev/null)"

  repoguard report . >/dev/null 2>&1
  fj="repoguard-results/findings.json"
  conf=$(count_status "$fj" confirmed); pot=$(count_status "$fj" potential)
  man=$(count_status "$fj" manual-verification); rej=$(count_status "$fj" rejected)

  printf "%-26s %-8s %-38s %s\n" "$name" "$seed" "$conf/$pot/$man/$rej" "${cost:-?}"
done

echo
echo "Per-repo reports refreshed at: <repo>/repoguard-results/reports/audit-report.md"
echo "Claude run logs at:            <repo>/repoguard-results/claude-deep-pass.json"
