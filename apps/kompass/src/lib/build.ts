/**
 * Die Build-Kennung des laufenden Images. Kommt über `KOMPASS_BUILD` aus dem
 * Docker-Build (CI: der Git-SHA; `pnpm image`: der kurze SHA). Ohne Wert —
 * also `next dev` oder ein Bau ohne das Argument — steht „dev“.
 */
export function buildId(): string {
  const raw = process.env.KOMPASS_BUILD?.trim();
  if (!raw || raw === 'local') return 'dev';
  const sha = raw.replace(/^sha-/, '');
  if (/^[0-9a-f]{7,40}$/i.test(sha)) return sha.slice(0, 7);
  return raw.slice(0, 16);
}

/**
 * Die Fassung des Produkts. Steht als einzige Quelle in der `package.json` im
 * Wurzelverzeichnis und wird von `next.config.ts` zur Bauzeit eingesetzt.
 * Ohne Bau — etwa in einem Unit-Test — steht `0.0.0-dev`: erkennbar keine
 * ausgelieferte Fassung, damit niemand sie fuer eine haelt.
 */
export function appVersion(): string {
  return process.env.KOMPASS_VERSION?.trim() || '0.0.0-dev';
}
