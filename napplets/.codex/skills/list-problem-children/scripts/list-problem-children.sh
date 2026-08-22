#!/usr/bin/env bash
set -euo pipefail

if (( $# != 1 )); then
  echo "usage: list-problem-children.sh <problem-id>" >&2
  exit 2
fi
command -v nak >/dev/null || { echo "error: nak is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "error: jq is required" >&2; exit 1; }

input_id=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
input_id=${input_id//.../…}
bootstrap_relays=(
  wss://purplepag.es
  wss://relay.damus.io
  wss://nos.lol
  wss://bucket.coracle.social
)

query_events() {
  nak req "$@" 2>/dev/null || true
}

if [[ $input_id =~ ^[0-9a-f]{64}$ ]]; then
  problem_id=$input_id
  parent_events=$(query_events -k 31971 -d "$problem_id" -l 500 "${bootstrap_relays[@]}")
else
  if [[ $input_id == *…* ]]; then
    prefix=${input_id%%…*}
    suffix=${input_id#*…}
  else
    prefix=$input_id
    suffix=
  fi
  [[ $prefix =~ ^[0-9a-f]{4,63}$ && ( -z $suffix || $suffix =~ ^[0-9a-f]{4,63}$ ) ]] || {
    echo "error: problem ID must be 64 lowercase hex characters, a hex prefix, or prefix…suffix" >&2
    exit 1
  }
  candidate_events=$(query_events -k 31971 -l 10000 --paginate "${bootstrap_relays[@]}")
  candidates=$(jq -r --arg prefix "$prefix" --arg suffix "$suffix" '
    [.tags[]? | select(.[0] == "d") | .[1]][] |
    select(startswith($prefix) and ($suffix == "" or endswith($suffix)))
  ' <<<"$candidate_events" | sort -u)
  candidate_count=$(grep -c . <<<"$candidates" || true)
  (( candidate_count == 1 )) || {
    echo "error: abbreviated problem ID matched $candidate_count logical IDs" >&2
    [[ -n $candidates ]] && printf '%s\n' "$candidates" >&2
    exit 1
  }
  problem_id=$candidates
  parent_events=$(jq -c --arg id "$problem_id" 'select(any(.tags[]?; .[0] == "d" and .[1] == $id))' <<<"$candidate_events")
fi

parent=$(jq -sc --arg id "$problem_id" '
  unique_by(.id)
  | map(select(any(.tags[]?; .[0] == "d" and .[1] == $id)))
  | if length == 0 then empty else max_by(.created_at) end
' <<<"$parent_events")
[[ -n $parent ]] || { echo "error: parent problem not found" >&2; exit 1; }
owner=$(jq -r '.tags[] | select(.[0] == "a" and .[3] == "origin") | .[1] | split(":")[1]' <<<"$parent" | head -1)
[[ $owner =~ ^[0-9a-f]{64}$ ]] || { echo "error: parent owner could not be resolved" >&2; exit 1; }
coordinate="31971:$owner:$problem_id"

profile_events=$(query_events -k 10002 -a "$owner" -l 50 "${bootstrap_relays[@]}")
author_relays=()
while IFS= read -r relay; do
  [[ -n $relay ]] && author_relays+=("$relay")
done < <(jq -rs '
  map(select(.pubkey == $owner)) | if length == 0 then [] else max_by(.created_at).tags end
  | [.[] | select(.[0] == "r" and (.[2] == null or .[2] != "read")) | .[1]] | unique[]
' --arg owner "$owner" <<<"$profile_events")
all_relays=("${bootstrap_relays[@]}" "${author_relays[@]}")
relays=()
while IFS= read -r relay; do
  [[ -n $relay ]] && relays+=("$relay")
done < <(printf '%s\n' "${all_relays[@]}" | awk '/^wss:\/\// && !seen[$0]++')

first_pass=$(query_events -k 31971 -t "a=$coordinate" -l 10000 --paginate "${relays[@]}")
child_authors=()
while IFS= read -r author; do
  [[ -n $author ]] && child_authors+=("$author")
done < <(jq -r --arg coordinate "$coordinate" '
  select(any(.tags[]?; .[0] == "a" and .[1] == $coordinate and .[3] == null)) | .pubkey
' <<<"$first_pass" | sort -u)

if (( ${#child_authors[@]} > 0 )); then
  author_args=()
  for author in "${child_authors[@]}"; do author_args+=(-a "$author"); done
  child_profiles=$(query_events -k 10002 "${author_args[@]}" -l 200 "${bootstrap_relays[@]}")
  child_relays=()
  while IFS= read -r relay; do
    [[ -n $relay ]] && child_relays+=("$relay")
  done < <(jq -rs '
    group_by(.pubkey) | map(max_by(.created_at))
    | [.[].tags[] | select(.[0] == "r" and (.[2] == null or .[2] != "read")) | .[1]] | unique[]
  ' <<<"$child_profiles")
  all_relays=("${relays[@]}" "${child_relays[@]}")
  relays=()
  while IFS= read -r relay; do
    [[ -n $relay ]] && relays+=("$relay")
  done < <(printf '%s\n' "${all_relays[@]}" | awk '/^wss:\/\// && !seen[$0]++')
fi

events=$(query_events -k 31971 -t "a=$coordinate" -l 10000 --paginate "${relays[@]}")
jq -rs --arg coordinate "$coordinate" '
  unique_by(.id)
  | map(select(any(.tags[]?; .[0] == "a" and .[1] == $coordinate and .[3] == null)))
  | (map([.tags[]? | select(.[0] == "e" and .[3] == "previous") | .[1]]) | add // [] | unique) as $previous
  | map(select(.id as $id | $previous | index($id) | not))
  | map({
      problemId: ([.tags[] | select(.[0] == "d") | .[1]][0]),
      eventId: .id,
      title: ([.tags[] | select(.[0] == "title") | .[1]][0] // "Untitled problem"),
      status: ([.tags[] | select(.[0] == "status") | .[1]][0] // "unknown"),
      description: .content
    })
  | unique_by(.problemId)
  | sort_by(.title | ascii_downcase)
  | "Found \(length) direct children of `\($coordinate | split(":")[2])`:\n",
    (.[] | "- `[\(.status)]` \(.title)\n  `\(.problemId[0:8])…\(.problemId[-6:])`\n  Full ID: `\(.problemId)`\n  Event: `\(.eventId)`\n  \(.description | gsub("\\n+"; " "))")
  | .
' -r <<<"$events"
