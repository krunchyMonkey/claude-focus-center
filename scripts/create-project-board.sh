#!/usr/bin/env bash
set -euo pipefail

OWNER="krunchyMonkey"
REPO="krunchyMonkey/claude-focus-center"
TITLE="Claude Focus Center Roadmap"

command -v gh >/dev/null || { echo 'Install GitHub CLI (gh) first.' >&2; exit 1; }
gh auth status >/dev/null || { echo 'Run gh auth login and gh auth refresh -s project.' >&2; exit 1; }

number="$(gh project list --owner "$OWNER" --limit 100 --format json --jq '.projects[] | select(.title == "Claude Focus Center Roadmap") | .number' | head -n 1)"
if [[ -z "$number" ]]; then
  number="$(gh project create --owner "$OWNER" --title "$TITLE" --format json --jq '.number')"
  echo "Created project #$number"
else
  echo "Reusing project #$number"
fi

if ! gh project link "$number" --owner "$OWNER" --repo "$REPO" 2>/dev/null; then
  echo 'Project may already be linked; check the repository Projects tab.' >&2
fi
gh project edit "$number" --owner "$OWNER" --description 'Claude Code attention dashboard: owner effort, releases, and investment choices.' --visibility PUBLIC >/dev/null

ensure_field() {
  local name="$1" datatype="$2" options=""
  if [[ $# -gt 2 ]]; then options="$3"; fi
  if gh project field-list "$number" --owner "$OWNER" --format json --jq '.fields[].name' | grep -Fxq "$name"; then return; fi
  if [[ "$datatype" == "SINGLE_SELECT" ]]; then
    gh project field-create "$number" --owner "$OWNER" --name "$name" --data-type "$datatype" --single-select-options "$options" >/dev/null
  else
    gh project field-create "$number" --owner "$OWNER" --name "$name" --data-type "$datatype" >/dev/null
  fi
}
ensure_field "Release" "SINGLE_SELECT" "Shipped,v0.1 Pilot,v0.2 Reliability,v0.3 UX/Beta,Explore"
ensure_field "Priority" "SINGLE_SELECT" "P0,P1,P2"
ensure_field "Decision" "SINGLE_SELECT" "Complete,Committed,Candidate,Optional,Parked"
ensure_field "Effort (h)" "NUMBER"
ensure_field "Owner attention (h)" "NUMBER"

set_item() {
  local issue="$1" release="$2" priority="$3" decision="$4" effort="$5" owner_hours="$6"
  local url="https://github.com/$REPO/issues/$issue"
  # Re-runnable: existing project items may report an already-added error.
  gh project item-add "$number" --owner "$OWNER" --url "$url" >/dev/null 2>&1 || echo "Issue #$issue already present, or add failed; updating its fields next." >&2
  gh project item-edit "$number" --owner "$OWNER" --url "$url" --field "Release" --value "$release" >/dev/null
  gh project item-edit "$number" --owner "$OWNER" --url "$url" --field "Priority" --value "$priority" >/dev/null
  gh project item-edit "$number" --owner "$OWNER" --url "$url" --field "Decision" --value "$decision" >/dev/null
  gh project item-edit "$number" --owner "$OWNER" --url "$url" --field "Effort (h)" --number "$effort" >/dev/null
  gh project item-edit "$number" --owner "$OWNER" --url "$url" --field "Owner attention (h)" --number "$owner_hours" >/dev/null
  echo "Issue #$issue -> $release ($effort h effort; $owner_hours h owner)"
}

for issue in $(seq 1 13); do
  set_item "$issue" "Shipped" "P0" "Complete" 0 0
  gh project item-edit "$number" --owner "$OWNER" --url "https://github.com/$REPO/issues/$issue" --field "Status" --value "Done" >/dev/null
done

set_item 14 "v0.1 Pilot" "P0" "Committed" 5 3
set_item 18 "v0.1 Pilot" "P0" "Committed" 3 1
set_item 20 "v0.2 Reliability" "P0" "Candidate" 8 2
set_item 21 "v0.2 Reliability" "P1" "Candidate" 8 1
set_item 22 "v0.2 Reliability" "P1" "Candidate" 6 2
set_item 23 "v0.3 UX/Beta" "P1" "Optional" 6 2
set_item 24 "v0.3 UX/Beta" "P2" "Optional" 10 2
set_item 25 "v0.3 UX/Beta" "P2" "Optional" 10 3
set_item 15 "Explore" "P2" "Parked" 6 2
set_item 16 "Explore" "P2" "Parked" 6 2

echo
printf 'Project ready: https://github.com/users/%s/projects/%s\n' "$OWNER" "$number"
echo 'Create Board (Status) and Roadmap (Release) views in the GitHub UI.'
echo 'See docs/ROADMAP.md for capacity assumptions and decision gates.'
