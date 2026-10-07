#!/bin/sh
# Die E2E-Suite an einem anderen Kalendertag — auf Bedarf, nicht Teil von `pnpm verify`, nicht in der CI.
#
#   scripts/e2e-kalender.sh [-n] [JJJJ-MM-TT …]
#
# Vorgabe sind die nächsten 2. Januar, 1. März und 15. September: zweimal liegt das Stichjahr des
# Entwicklungs-Seeds im Vorjahr (Jahreswechsel, Frühjahr), einmal im laufenden Jahr
# (`packages/core/src/seed/story-year.ts`, `apps/kompass/e2e/story-year.ts`). Je Tag ein
# kalter Dev-Ring (`pnpm e2e:cold`) über die E2E-Sperre, also so lange wie dieser, je Tag. Die Uhr
# geht in jedem Node-Prozess (Playwright, `next dev`, Worker) um denselben Versatz vor —
# `scripts/fake-date.mjs` über NODE_OPTIONS —, im Browser über `page.clock` (`apps/kompass/e2e/fixtures.ts`).
#
# `-n` zeigt nur, was liefe. Die `export`-Zeilen taugen für eine einzelne Spec:
#   eval "$(scripts/e2e-kalender.sh -n 2027-03-01 | grep '^export')"
#   cd apps/kompass && ../../scripts/e2e-lock.sh npx playwright test e2e/finance-donation-book.spec.ts
#
# Nur Tage nach heute: Das Sitzungs-Cookie trägt ein festes Ablaufdatum (`request-context.ts`), an einem
# vergangenen Tag verfiele es im Browser sofort. Der Container-Ring bleibt außen vor: `docker run`
# reicht die Umgebung nicht durch, und die Verpackung hängt nicht am Datum.
# Warum es das gibt: Plan docs/intern/plans/2026-10-06-seed-kalender.md (der Seed lief nur Ende August bis Silvester).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
dry=''
if [ "${1:-}" = "-n" ]; then dry=1; shift; fi
# Jede Node-Ausgabe erst in eine Variable: `set -- $(node …)` verschluckte einen Fehler, und null Tage
# liefen dann mit Exit 0 durch — ein stiller Erfolg. Unter `set -e` bricht `x=$(…)` dagegen ab.
if [ "$#" -eq 0 ]; then
  days=$(node -e '
    const now = Date.now();
    const year = new Date(now).getUTCFullYear();
    const next = (md) => [year, year + 1].map((y) => `${y}-${md}`).find((d) => Date.parse(`${d}T10:00:00.000Z`) > now);
    console.log(["01-02", "03-01", "09-15"].map(next).join(" "));')
  # shellcheck disable=SC2086 # gewollt: die Tage einzeln
  set -- $days
fi
if [ "$#" -eq 0 ]; then
  echo 'e2e-kalender: keine Tage — null Tage sind kein Erfolg' >&2
  exit 1
fi
# Als URL mit %20 statt Leerzeichen: NODE_OPTIONS trennt an Leerzeichen.
preload=$(node -e 'console.log(require("node:url").pathToFileURL(process.argv[1]).href)' "$root/scripts/fake-date.mjs")
if [ -z "$preload" ]; then
  echo 'e2e-kalender: keine URL für scripts/fake-date.mjs' >&2
  exit 1
fi
status=0
for day in "$@"; do
  offset=$(node -e '
    const day = process.argv[1];
    const at = Date.parse(`${day}T10:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== day) {
      console.error(`e2e-kalender: kein Tag (JJJJ-MM-TT): ${day}`);
      process.exit(64);
    }
    if (at <= Date.now()) {
      console.error(`e2e-kalender: nur Tage nach heute, nicht ${day}`);
      process.exit(64);
    }
    console.log(at - Date.now());' "$day")
  if [ -z "$offset" ]; then
    echo "e2e-kalender: kein Versatz für $day" >&2
    exit 1
  fi
  echo "== E2E am $day =="
  if [ -n "$dry" ]; then
    echo "export FAKE_OFFSET_MS=$offset"
    echo "export NODE_OPTIONS=--import=$preload"
    echo "$root/scripts/e2e-lock.sh pnpm --dir $root e2e:cold"
    continue
  fi
  FAKE_OFFSET_MS=$offset NODE_OPTIONS="--import=$preload" "$root/scripts/e2e-lock.sh" pnpm --dir "$root" e2e:cold || status=1
done
exit "$status"
