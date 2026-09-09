/**
 * Die Build-Kennung des laufenden Images. Kommt über `KOMPASS_BUILD` aus dem
 * Docker-Build (CI: der Git-SHA; `pnpm image`: der kurze SHA). Ohne Wert —
 * also `next dev` oder ein Bau ohne das Argument — steht „dev".
 */
export function buildId(): string {
  const raw = process.env.KOMPASS_BUILD?.trim();
  if (!raw || raw === 'local') return 'dev';
  const sha = raw.replace(/^sha-/, '');
  if (/^[0-9a-f]{7,40}$/i.test(sha)) return sha.slice(0, 7);
  return raw.slice(0, 16);
}
