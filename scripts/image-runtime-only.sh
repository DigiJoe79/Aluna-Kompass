#!/usr/bin/env bash
# Prueft, dass ein gebautes Image keine Entwicklungswerkzeuge mitbringt.
#
# Bis zur Release-Pruefung (Q5) kopierte das Image die volle node_modules aus
# dem Bau: 874 MB, darin Playwright, vitest, eslint, TypeScript und drizzle-kit
# samt dem einzigen Befund von `pnpm audit`. Nichts davon laeuft im Container,
# aber alles liegt dort, wird mitverteilt und muss gepflegt werden. Eine
# einmalige Messung haelt das nicht; diese Pruefung schon.
#
#   scripts/image-runtime-only.sh [image]    Vorgabe: kompass-local
set -euo pipefail

IMAGE="${1:-kompass-local}"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image '$IMAGE' gibt es nicht. Erst 'pnpm image' bauen." >&2
  exit 1
fi

# Namen, wie pnpm sie unter node_modules/.pnpm ablegt (`/` wird zu `+`).
WERKZEUGE='^(@playwright\+test|playwright|playwright-core|vitest|@vitest\+[^@]+|eslint|eslint-config-next|@typescript-eslint\+[^@]+|typescript|drizzle-kit|@esbuild-kit\+[^@]+|tsx|shadcn)@'

gefunden=$(docker run --rm --entrypoint sh "$IMAGE" -c 'ls /app/node_modules/.pnpm' | grep -E "$WERKZEUGE" || true)
groesse=$(docker run --rm --entrypoint sh "$IMAGE" -c 'du -sm /app/node_modules | cut -f1')

if [ -n "$gefunden" ]; then
  echo "Das Image '$IMAGE' traegt Entwicklungswerkzeuge (node_modules: ${groesse} MB):" >&2
  echo "$gefunden" | sed 's/^/  /' >&2
  exit 1
fi
echo "Image '$IMAGE' ohne Entwicklungswerkzeuge, node_modules: ${groesse} MB"
