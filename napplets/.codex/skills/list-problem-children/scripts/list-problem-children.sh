#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: list-problem-children.sh [--open-leaves] [--debug] <problem-id>" >&2
  exit 2
}

mode=children
debug=false
while (( $# > 0 )); do
  case $1 in
    --open-leaves) mode=open-leaves ;;
    --debug) debug=true ;;
    --) shift; break ;;
    -*) usage ;;
    *) break ;;
  esac
  shift
done
(( $# == 1 )) || usage

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
  local label=$1
  shift
  local started=$SECONDS output
  output=$(nak req "$@" 2>/dev/null || true)
  if $debug; then
    echo "debug: query ($label) took $((SECONDS - started))s" >&2
  fi
  printf '%s' "$output"
}

matches_input='def logical_id: first(.tags[]? | select(.[0] == "d") | .[1]);
  logical_id as $id
  | select(($id | startswith($prefix)) and ($suffix == "" or ($id | endswith($suffix))))'

if [[ $input_id =~ ^[0-9a-f]{64}$ ]]; then
  problem_id=$input_id
  if [[ $mode == children ]]; then
    discovery=$(query_events parent -k 31971 -d "$problem_id" -l 500 "${bootstrap_relays[@]}")
  else
    discovery=$(query_events graph-discovery -k 31971 -l 10000 "${bootstrap_relays[@]}")
  fi
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
  discovery=$(query_events graph-discovery -k 31971 -l 10000 "${bootstrap_relays[@]}")
  candidates=$(jq -r --arg prefix "$prefix" --arg suffix "$suffix" "$matches_input | [.tags[] | select(.[0] == \"d\") | .[1]][0]" <<<"$discovery" | sort -u)
  candidate_count=$(grep -c . <<<"$candidates" || true)
  (( candidate_count == 1 )) || {
    echo "error: abbreviated problem ID matched $candidate_count logical IDs" >&2
    [[ -n $candidates ]] && printf '%s\n' "$candidates" >&2
    exit 1
  }
  problem_id=$candidates
fi

parent=$(jq -sc --arg id "$problem_id" '
  unique_by(.id)
  | map(select(any(.tags[]?; .[0] == "d" and .[1] == $id)))
  | if length == 0 then empty else max_by(.created_at) end
' <<<"$discovery")
if [[ -z $parent && $mode == children ]]; then
  parent_events=$(query_events parent -k 31971 -d "$problem_id" -l 500 "${bootstrap_relays[@]}")
  discovery+=$'\n'$parent_events
  parent=$(jq -sc --arg id "$problem_id" 'unique_by(.id) | map(select(any(.tags[]?; .[0] == "d" and .[1] == $id))) | if length == 0 then empty else max_by(.created_at) end' <<<"$parent_events")
fi
[[ -n $parent ]] || { echo "error: parent problem not found" >&2; exit 1; }
owner=$(jq -r '.tags[] | select(.[0] == "a" and .[3] == "origin") | .[1] | split(":")[1]' <<<"$parent" | head -1)
[[ $owner =~ ^[0-9a-f]{64}$ ]] || { echo "error: parent owner could not be resolved" >&2; exit 1; }
coordinate="31971:$owner:$problem_id"

if [[ $mode == children ]]; then
  # Repeat discovery with exact coordinate now that parent owner is known.
  first_pass=$(query_events child-discovery -k 31971 -t "a=$coordinate" -l 10000 "${bootstrap_relays[@]}")
else
  first_pass=$discovery
fi

authors=()
while IFS= read -r author; do
  [[ -n $author ]] && authors+=("$author")
done < <(jq -r '.pubkey' <<<"$first_pass" | sort -u)

events=$first_pass
if (( ${#authors[@]} > 0 )); then
  author_args=()
  for author in "${authors[@]}"; do author_args+=(-a "$author"); done
  outbox_events=$(query_events author-outboxes -k 31971 "${author_args[@]}" -l 10000 --outbox --outbox-relays-per-pubkey 5 "${bootstrap_relays[@]}")
  events+=$'\n'$outbox_events
fi

if [[ $mode == children ]]; then
  jq -rs --arg coordinate "$coordinate" '
    unique_by(.id)
    | map(select(any(.tags[]?; .[0] == "a" and .[1] == $coordinate and .[3] == null)))
    | (map([.tags[]? | select(.[0] == "e" and .[3] == "previous") | .[1]]) | add // [] | unique) as $previous
    | map(select(.id as $id | $previous | index($id) | not))
    | map({
        problemId: ([.tags[] | select(.[0] == "d") | .[1]][0]), eventId: .id,
        title: ([.tags[] | select(.[0] == "title") | .[1]][0] // "Untitled problem"),
        status: ([.tags[] | select(.[0] == "status") | .[1]][0] // "unknown"), description: .content
      })
    | unique_by(.problemId) | sort_by(.title | ascii_downcase)
    | "Found \(length) direct children of `\($coordinate | split(":")[2])`:\n",
      (.[] | "- `[\(.status)]` \(.title)\n  `\(.problemId[0:8])…\(.problemId[-6:])`\n  Full ID: `\(.problemId)`\n  Event: `\(.eventId)`\n  \(.description | gsub("\\n+"; " "))")
  ' -r <<<"$events"
else
  jq -rs --arg root "$coordinate" '
    def tag($name): first(.tags[]? | select(.[0] == $name) | .[1]);
    def origin: first(.tags[]? | select(.[0] == "a" and .[3] == "origin") | .[1]);
    unique_by(.id)
    | (map([.tags[]? | select(.[0] == "e" and .[3] == "previous") | .[1]]) | add // [] | unique) as $previous
    | map(select(.id as $id | $previous | index($id) | not))
    | map(. + {coordinate: origin, parent: first(.tags[]? | select(.[0] == "a" and .[3] == null) | .[1])})
    | map(select(.coordinate != null))
    | . as $nodes
    | [$root] | until(
        . as $known | ([$nodes[] | select(.parent as $p | $known | index($p)) | .coordinate] + $known | unique) == $known;
        . as $known | [$nodes[] | select(.parent as $p | $known | index($p)) | .coordinate] + $known | unique
      ) as $reachable
    | [$nodes[] | select(.coordinate != $root and (.coordinate as $c | $reachable | index($c)))
        | select(.coordinate as $c | any($nodes[]; .parent == $c) | not)
        | select((tag("status") // "open") == "open")
        | {problemId: tag("d"), eventId: .id, title: (tag("title") // "Untitled problem"), status: (tag("status") // "open"), description: .content}]
    | unique_by(.problemId) | sort_by(.title | ascii_downcase)
    | "Found \(length) open leaf nodes under `\($root | split(":")[2])`:\n",
      (.[] | "- `[\(.status)]` \(.title)\n  `\(.problemId[0:8])…\(.problemId[-6:])`\n  Full ID: `\(.problemId)`\n  Event: `\(.eventId)`\n  \(.description | gsub("\\n+"; " "))")
  ' -r <<<"$events"
fi
