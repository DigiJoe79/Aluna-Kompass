#!/usr/bin/env bash
# Räumt nach einem Release den Zyklus einer Fassung ab (AGENTS.md, „Ablauf
# einer Fassung“, Schritt 5):
#
#   scripts/zyklus-aufraeumen.sh <x.y.z> [-n]
#
#   -n  zeigt nur, was geschähe.
#
# 1. Prüft, dass dev-x.y.z ausgeliefert ist: Der Tag vX.Y.Z existiert und
#    trägt denselben Inhalt wie der Branch. Sonst bricht es ab — ein Branch mit
#    ungelieferter Arbeit wird nie gelöscht.
# 2. Setzt das lokale Archiv-Tag archiv/x.y.z auf den Branch. Es wird nie
#    gepusht (kein `git push --tags`); die Zwischenstände bleiben so lokal.
# 3. Löscht in der Registry die Image-Versionen, deren Tags **nur** zum Zyklus
#    gehören: `dev-x.y.z` und `sha-…` von Commits, die allein auf dem Branch
#    liegen. Eine Version mit Release-Nummer oder `latest` bleibt, auch wenn sie
#    zusätzlich ein `sha-`-Tag trägt; eine ohne Tag wird nie angefasst (sie
#    kann Teil eines anderen Images sein).
# 4. Löscht die Actions-Caches des Branches und des Release-Tags. Ein Cache
#    ist nur für seinen eigenen Ref lesbar; nach dem Release nützt er niemandem
#    mehr, belegt aber das Kontingent von 10 GB je Repo — ist es voll, wirft
#    GitHub nach eigenem Ermessen hinaus, womöglich gerade die nützlichen.
# 5. Löscht die Läufe des Branches samt Logs und Artefakten. Der Tag-Lauf
#    bleibt: Er ist der Nachweis, womit das Release gebaut und geprüft wurde.
# 6. Löscht den Branch auf GitHub und lokal.
#
# Braucht `gh` mit dem Scope delete:packages.
set -euo pipefail

usage() { echo "Aufruf: $(basename "$0") <x.y.z> [-n]" >&2; exit 2; }

version="${1:-}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
dry=""
case "${2:-}" in "") ;; -n) dry=1 ;; *) usage ;; esac

branch="dev-$version"
tag="v$version"
package="${KOMPASS_IMAGE_PACKAGE:-aluna-kompass}"
owner="$(gh repo view --json owner --jq .owner.login)"
api="/users/$owner/packages/container/$package/versions"

run() { if [ -n "$dry" ]; then echo "  würde: $*"; else "$@"; fi; }

git rev-parse -q --verify "refs/heads/$branch" >/dev/null || { echo "Branch $branch gibt es lokal nicht." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/$tag" >/dev/null || { echo "Tag $tag gibt es nicht — erst releasen, dann aufräumen." >&2; exit 1; }
if ! git diff --quiet "$tag" "$branch"; then
  echo "$branch weicht von $tag ab — dort liegt Arbeit, die nicht ausgeliefert ist. Abbruch." >&2
  git diff --stat "$tag" "$branch" >&2
  exit 1
fi
echo "$branch ist ausgeliefert ($tag, gleicher Inhalt)."

# Tags, die zum Zyklus gehören: dev-x.y.z und die sha-Tags der Commits, die nur
# auf dem Branch liegen. Eine Liste statt eines Arrays — macOS bringt Bash 3.2
# mit, und das kennt keine assoziativen Arrays.
cycle="$(printf 'dev-%s\n' "$version"; git rev-list "$tag..$branch" | cut -c1-7 | sed 's/^/sha-/')"
in_cycle() { printf '%s\n' "$cycle" | grep -qxF -- "$1"; }

echo "Archiv-Tag archiv/$version:"
if git rev-parse -q --verify "refs/tags/archiv/$version" >/dev/null; then
  echo "  steht schon."
else
  run git tag "archiv/$version" "$branch"
fi

echo "Image-Versionen in der Registry ($owner/$package):"
while IFS=$'\t' read -r id tags; do
  [ -z "$tags" ] && continue
  own=1
  IFS=',' read -ra list <<<"$tags"
  for t in "${list[@]}"; do in_cycle "$t" || own=""; done
  if [ -n "$own" ]; then
    echo "  löschen: $id ($tags)"
    run gh api -X DELETE "$api/$id" --silent
  else
    echo "  bleibt:  $id ($tags)"
  fi
done < <(gh api "$api?per_page=100" --paginate --jq '.[] | "\(.id)\t\(.metadata.container.tags | join(","))"')

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

echo "Actions-Caches von $branch und $tag:"
count=0
while IFS=$'\t' read -r id ref size; do
  count=$((count + 1))
  run gh api -X DELETE "/repos/$repo/actions/caches/$id" --silent
done < <(gh api "/repos/$repo/actions/caches?per_page=100" --paginate \
  --jq ".actions_caches[] | select(.ref == \"refs/heads/$branch\" or (.ref | endswith(\"refs/tags/$tag\"))) | \"\(.id)\t\(.ref)\t\(.size_in_bytes)\"")
echo "  $count Einträge."

echo "Läufe von $branch:"
count=0
while read -r id; do
  count=$((count + 1))
  run gh api -X DELETE "/repos/$repo/actions/runs/$id" --silent
done < <(gh api "/repos/$repo/actions/runs?branch=$branch&per_page=100" --paginate --jq '.workflow_runs[].id')
echo "  $count Läufe."

echo "Branch $branch:"
if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  run git push origin --delete "$branch"
else
  echo "  auf GitHub schon weg."
fi
if [ "$(git branch --show-current)" = "$branch" ]; then
  echo "  lokal ausgecheckt — erst auf main wechseln, dann erneut aufrufen." >&2
  exit 1
fi
run git branch -D "$branch"

[ -n "$dry" ] && echo "Probelauf — nichts geändert." || echo "Zyklus $version aufgeräumt."
