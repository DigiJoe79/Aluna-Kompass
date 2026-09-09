import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { TypstRenderer } from './renderer';

const ID = /^[a-z][a-z0-9-]{1,40}$/;

export interface ResolvedBase {
  id: string;
  typst: string;
  checksum: string;
  label: string;
  kind: string;
}

function readManifest(dir: string): Record<string, { label?: string; kind?: string }> {
  const file = path.join(dir, 'bases.json');
  if (!existsSync(file)) return {};
  try {
    const list = JSON.parse(readFileSync(file, 'utf8')) as { id: string; label?: string; kind?: string }[];
    return Object.fromEntries(list.map((b) => [b.id, { label: b.label, kind: b.kind }]));
  } catch {
    return {};
  }
}

function readDir(dir: string): Map<string, ResolvedBase> {
  const out = new Map<string, ResolvedBase>();
  if (!existsSync(dir)) return out;
  const manifest = readManifest(dir);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.typ')) continue;
    const id = name.slice(0, -4);
    if (!ID.test(id)) continue;
    const typst = readFileSync(path.join(dir, name), 'utf8');
    out.set(id, {
      id,
      typst,
      checksum: createHash('sha256').update(typst).digest('hex'),
      label: manifest[id]?.label ?? id,
      kind: manifest[id]?.kind ?? 'plain',
    });
  }
  return out;
}

/** Mitgeliefert (`<templatesDir>/bases`) plus Volume-Overlay; das Overlay gewinnt je ID. */
export function resolveBases(dirs: { templatesDir: string; documentTemplatesDir: string | null }): Map<string, ResolvedBase> {
  const bases = readDir(path.join(dirs.templatesDir, 'bases'));
  if (dirs.documentTemplatesDir) {
    for (const [id, base] of readDir(dirs.documentTemplatesDir)) bases.set(id, base);
  }
  return bases;
}

const PROBE_PAYLOAD = {
  brand: {
    primary: '#2F5D68',
    primarySoft: '#E3EEF0',
    accent: '#9C5637',
    ink: '#191C1F',
    muted: '#666D75',
    line: '#E4E4E0',
    fontBody: 'Source Sans 3',
    fontHeading: 'Source Serif 4',
    fontMono: 'IBM Plex Mono',
  },
  organization: { 'organization.name': 'Musterverein e.V.', 'organization.city': 'Musterstadt' },
  number: 'TST-2026-001',
  issuedDate: '01.01.2026',
  slots: { kind: 'plain', title: 'Prüfung' },
};

/** Prüf-Render einer Basis mit Minimal-Payload — fängt Signatur-, Schrift- und Grafikfehler ab. */
export async function probeBase(opts: {
  renderer: TypstRenderer;
  baseId: string;
  bases: Map<string, ResolvedBase>;
  fontPaths?: string[];
  assetsDir?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!opts.bases.has(opts.baseId)) return { ok: false, error: 'not found' };
  try {
    await opts.renderer.renderDocument({
      baseId: opts.baseId,
      bases: opts.bases,
      bodyTypst: 'Prüftext.',
      payload: PROBE_PAYLOAD,
      fontPaths: opts.fontPaths,
      assetsDir: opts.assetsDir,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
