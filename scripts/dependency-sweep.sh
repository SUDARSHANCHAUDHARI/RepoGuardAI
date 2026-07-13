#!/usr/bin/env bash
#
# dependency-sweep.sh — safe, in-range dependency refresh for dev-phase repos.
#
# Per repo: restores node_modules, runs `pnpm update` + `pnpm dedupe` (stays
# within each package's semver range — NO major bumps), and reports the
# `pnpm audit` critical/high delta. Commits nothing; leaves changes for review.
# Criticals that remain need a manual major-version bump.
#
# Usage:
#   ./dependency-sweep.sh /path/to/repo [/path/to/repo2 ...]
#   ./dependency-sweep.sh --criticals   # repos with >=1 critical in latest rollup

set -uo pipefail
ROOT="${REPOGUARD_ROOT:-$PWD}"
command -v pnpm >/dev/null 2>&1 || { echo "pnpm not found"; exit 1; }

repos=()
if [ "${1:-}" = "--criticals" ]; then
  rollup="$(ls -t "$ROOT"/repoguard-portfolio-*.md 2>/dev/null | head -1)"
  [ -z "$rollup" ] && { echo "No rollup found."; exit 1; }
  while IFS= read -r line; do
    cat="$(echo "$line"  | awk -F'|' '{gsub(/^ +| +$/,"",$2);print $2}')"
    repo="$(echo "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$3);print $3}')"
    sev="$(echo "$line"  | awk -F'|' '{s=$4;gsub(/[^0-9\/]/,"",s);print s}')"
    [ "${sev%%/*}" -gt 0 ] 2>/dev/null && [ -f "$ROOT/$cat/$repo/pnpm-lock.yaml" ] && repos+=("$ROOT/$cat/$repo")
  done < <(grep -E '^\| [A-Za-z]' "$rollup" | grep -vE 'Category')
else
  repos=("$@")
fi
[ ${#repos[@]} -eq 0 ] && { echo "No pnpm repos to sweep."; exit 1; }

# pnpm audit critical+high count (echoes "crit high"). pnpm emits one JSON
# object with metadata.vulnerabilities.
audit_ch() {
  pnpm audit --json 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{const v=JSON.parse(s).metadata.vulnerabilities;
        console.log((v.critical||0)+" "+(v.high||0));
      }catch{console.log("? ?");}
    });' 2>/dev/null || echo "? ?"
}

printf "%-26s %-14s %-14s %s\n" "REPO" "BEFORE c/h" "AFTER c/h" "RESULT"
for repo in "${repos[@]}"; do
  name="$(basename "$repo")"
  cd "$repo" 2>/dev/null || { echo "$name  (cd failed)"; continue; }
  [ -f pnpm-lock.yaml ] || { printf "%-26s %s\n" "$name" "(not pnpm — skipped)"; continue; }

  pnpm install --silent >/dev/null 2>&1 || { printf "%-26s %s\n" "$name" "(install failed)"; continue; }
  read -r b_c b_h <<<"$(audit_ch)"

  pnpm update  >/dev/null 2>&1
  pnpm dedupe  >/dev/null 2>&1 || true
  read -r a_c a_h <<<"$(audit_ch)"

  result="in-range update applied"
  [ "${a_c:-0}" != "0" ] 2>/dev/null && result="$a_c critical(s) remain → need major bump"
  [ "${a_c:-x}" = "0" ] && [ "${b_c:-0}" != "0" ] && result="criticals cleared ✓"
  printf "%-26s %-14s %-14s %s\n" "$name" "${b_c:-?}/${b_h:-?}" "${a_c:-?}/${a_h:-?}" "$result"
done

echo
echo "Changes are UNCOMMITTED in each repo (package.json / pnpm-lock.yaml)."
echo "Review, run the repo's build/test, then commit. Remaining criticals need a"
echo "manual major-version bump (e.g. pnpm up next@latest) + testing."
