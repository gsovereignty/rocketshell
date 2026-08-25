#!/usr/bin/env bash
set -euo pipefail

skill_dir=$(cd "$(dirname "$0")/.." && pwd)
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
root=$(printf 'a%.0s' {1..64})
owner=$(printf '1%.0s' {1..64})
child=$(printf 'b%.0s' {1..64})
grandchild=$(printf 'c%.0s' {1..64})
closed=$(printf 'd%.0s' {1..64})
forked=$(printf 'e%.0s' {1..64})

event() {
  local id=$1 pubkey=$2 created=$3 problem=$4 title=$5 status=$6 parent=$7 previous=${8:-}
  jq -nc --arg id "$id" --arg pubkey "$pubkey" --argjson created "$created" \
    --arg problem "$problem" --arg title "$title" --arg status "$status" \
    --arg origin "31971:$pubkey:$problem" --arg parent "$parent" --arg previous "$previous" '
    {id:$id,pubkey:$pubkey,created_at:$created,kind:31971,content:($title + " body"),
     tags:([ ["d",$problem], ["title",$title], ["status",$status], ["a",$origin,"","origin"] ]
       + (if $parent == "" then [] else [["a",$parent]] end)
       + (if $previous == "" then [] else [["e",$previous,"","previous"]] end))}'
}

root_event=$(event "$(printf '0%.0s' {1..64})" "$owner" 1 "$root" Root open "")
old_child_event=$(event "$(printf '2%.0s' {1..64})" "$owner" 2 "$child" "Old child" open "31971:$owner:$root")
child_event=$(event "$(printf '3%.0s' {1..64})" "$owner" 3 "$child" Child open "31971:$owner:$root" "$(printf '2%.0s' {1..64})")
grandchild_event=$(event "$(printf '4%.0s' {1..64})" "$owner" 4 "$grandchild" Grandchild open "31971:$owner:$child")
closed_event=$(event "$(printf '5%.0s' {1..64})" "$owner" 5 "$closed" Closed closed "31971:$owner:$root")
fork_a_event=$(event "$(printf '6%.0s' {1..64})" "$owner" 6 "$forked" "Forked work A" open "31971:$owner:$root")
fork_b_event=$(event "$(printf '7%.0s' {1..64})" "$owner" 7 "$forked" "Forked work B" open "31971:$owner:$root")
printf '%s\n' "$root_event" "$old_child_event" "$child_event" "$grandchild_event" "$closed_event" >"$temp_dir/events.jsonl"

mkdir "$temp_dir/bin"
cat >"$temp_dir/bin/nak" <<'NAK'
#!/usr/bin/env bash
fixture_dir=$(cd "$(dirname "$0")/.." && pwd)
root=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
owner=1111111111111111111111111111111111111111111111111111111111111111
printf x >>"$fixture_dir/calls"
if [[ " $* " == *" -d $root "* ]]; then
  jq -c --arg root "$root" 'select(any(.tags[]?; .[0] == "d" and .[1] == $root))' "$fixture_dir/events.jsonl"
elif [[ " $* " == *" -t a=31971:$owner:$root "* ]]; then
  jq -c --arg coordinate "31971:$owner:$root" 'select(any(.tags[]?; .[0] == "a" and .[1] == $coordinate and .[3] == null))' "$fixture_dir/events.jsonl"
else
  cat "$fixture_dir/events.jsonl"
fi
NAK
chmod +x "$temp_dir/bin/nak"

export PATH="$temp_dir/bin:$PATH"

children=$(bash "$skill_dir/scripts/list-problem-children.sh" --debug "$root" 2>"$temp_dir/children.err")
grep -q 'Found 2 direct children' <<<"$children"
grep -q 'Child' <<<"$children"
grep -q 'Closed' <<<"$children"
! grep -q 'Old child' <<<"$children"
[[ $(grep -c '^debug: query' "$temp_dir/children.err") == 3 ]]

printf '%s\n' "$fork_a_event" "$fork_b_event" >>"$temp_dir/events.jsonl"
: >"$temp_dir/calls"
leaves=$(bash "$skill_dir/scripts/list-problem-children.sh" --open-leaves --debug "${root:0:8}…${root: -6}" 2>"$temp_dir/leaves.err")
grep -q 'Found 1 claimable open problems' <<<"$leaves"
grep -q 'Grandchild' <<<"$leaves"
! grep -q 'Closed' <<<"$leaves"
! grep -q 'Root' <<<"$leaves"
! grep -q '] Child$' <<<"$leaves"
! grep -q 'Forked work' <<<"$leaves"
[[ $(grep -c '^debug: query' "$temp_dir/leaves.err") == 2 ]]

echo "query plan tests passed"
