import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Allowlist, allowlistHygiene, classNameValue, matchingLines, openingTags, read, relative, SRC, sourceFiles, staleKeys } from './source';

/**
 * Höhen folgen dem dynamischen Viewport (`dvh`), nicht dem großen (`h-screen`/`min-h-screen` = `100vh`, `lvh`).
 * Safari bindet `100vh` an die Höhe bei ausgeblendeter Symbolleiste. Steht die Symbolleiste beim Laden (der
 * Normalfall), bleibt unter der Hülle (`h-dvh` in `(shell)/layout.tsx`) toter, aber scrollbarer Raum auf
 * Dokumentebene — die Topbar wandert mit, ein Tipp aufs Menü trifft eine Tabellenzeile darunter. Playwright kann
 * die iOS-Symbolleiste nicht auslösen; bis 0.3.1 prüfte ein E2E-Fall die `class` von `body` im Browser.
 */
const LARGE_VIEWPORT = /\b(min-h|h|max-h)-(screen|lvh)\b|\b100l?vh\b/;

export const ALLOWED: Allowlist = {};

const hits = () => sourceFiles().flatMap((file) => matchingLines(file, read(file), LARGE_VIEWPORT).map((where) => ({ where, file: relative(file) })));

describe('dynamischer Viewport', () => {
  it('`body` trägt `min-h-dvh` wie die Hülle', () => {
    const [body] = openingTags(read(path.join(SRC, 'app/layout.tsx')), /body/);
    expect(body).toBeDefined();
    expect(classNameValue(body!.tag)).toMatch(/\bmin-h-dvh\b/);
  });

  it('keine Höhe am großen Viewport außerhalb der Erlaubnisliste', () => {
    expect(hits().filter(({ file }) => !(file in ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => staleKeys(ALLOWED, hits().map(({ file }) => file)));
});
