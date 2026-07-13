#!/usr/bin/env bash
#
# portfolio-audit.sh — run RepoGuardAI across your categorized repo folders.
#
# Usage:
#   ./portfolio-audit.sh                 # audit ALL code categories
#   ./portfolio-audit.sh AIProjects      # audit one category
#   ./portfolio-audit.sh AndroidApps CyberSecurity   # audit several
#
# For each git repo found it runs `repoguard audit .`, which writes
# repoguard-results/ (findings.json + md/json/sarif) INSIDE that repo, adds
# repoguard-results/ to the repo's .gitignore, and appends a row to a rollup.
#
# Deterministic only (no AI cost). Add the AI deep-pass separately.

set -uo pipefail

# Root directory that contains your category folders (each holding repos).
# Defaults to the current directory; override with REPOGUARD_ROOT.
ROOT="${REPOGUARD_ROOT:-$PWD}"

# Category folder names to skip (no code to audit). Override with REPOGUARD_SKIP
# (a '|'-separated list). Default skips common non-code dirs.
SKIP="${REPOGUARD_SKIP:-.git|node_modules|.github}"

# Locate the CLI: prefer the PATH command, fall back to the built dist next to
# this script (scripts/ lives beside dist/ in the RepoGuardAI package).
if command -v repoguard >/dev/null 2>&1; then
  RG() { repoguard "$@"; }
else
  DIST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist/cli.js"
  RG() { node "$DIST" "$@"; }
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
ROLLUP="$ROOT/repoguard-portfolio-$STAMP.md"

# Which categories to process (args, or all non-skipped dirs).
if [ "$#" -gt 0 ]; then
  CATEGORIES=("$@")
else
  CATEGORIES=()
  for c in "$ROOT"/*/; do
    name="$(basename "$c")"
    [ -d "$c/.git" ] && continue                       # top-level repo, not a category
    echo "$name" | grep -qE "^($SKIP)$" && continue
    CATEGORIES+=("$name")
  done
fi

# Count findings by severity from a findings.json (echoes: crit high med low info).
counts() {
  node -e '
    try {
      const f = require(process.argv[1]);
      const c = {};
      for (const x of f.findings) c[x.severity] = (c[x.severity] || 0) + 1;
      console.log([c.critical||0, c.high||0, c.medium||0, c.low||0, c.informational||0].join(" "));
    } catch { console.log("0 0 0 0 0"); }
  ' "$1" 2>/dev/null || echo "0 0 0 0 0"
}

{
  echo "# RepoGuard Portfolio Audit — $STAMP"
  echo
  echo "| Category | Repo | Findings (C/H/M/L/I) |"
  echo "| --- | --- | --- |"
} > "$ROLLUP"

printf "%-22s %-28s %s\n" "CATEGORY" "REPO" "C/H/M/L/I"
printf "%-22s %-28s %s\n" "--------" "----" "---------"

for cat in "${CATEGORIES[@]}"; do
  catdir="$ROOT/$cat"
  [ -d "$catdir" ] || { echo "  (no such category: $cat)"; continue; }

  # Every git repo up to 2 levels deep inside the category.
  find "$catdir" -maxdepth 2 -name .git -type d 2>/dev/null | sed 's|/\.git$||' | sort | while read -r repo; do
    name="$(basename "$repo")"

    # Deterministic run: drop any stale seed so findings reflect current code.
    rm -f "$repo/repoguard-results/findings.json"
    ( cd "$repo" && RG audit . >/dev/null 2>&1 ) || true

    # Keep RepoGuard output out of the repo's git history.
    gi="$repo/.gitignore"
    if [ -f "$gi" ]; then
      grep -qxF 'repoguard-results/' "$gi" || printf '\nrepoguard-results/\n' >> "$gi"
    else
      printf 'repoguard-results/\n' > "$gi"
    fi

    fj="$repo/repoguard-results/findings.json"
    read -r c h m l i <<<"$(counts "$fj")"
    printf "%-22s %-28s %s/%s/%s/%s/%s\n" "$cat" "$name" "$c" "$h" "$m" "$l" "$i"
    echo "| $cat | $name | $c/$h/$m/$l/$i |" >> "$ROLLUP"
  done
done

echo
echo "Rollup written: $ROLLUP"
echo "Per-repo details live in each repo under: repoguard-results/reports/audit-report.md"
