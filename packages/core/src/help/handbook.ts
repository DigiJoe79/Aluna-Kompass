import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeEnv } from '../app';

/** In der Entwicklung liegt das Handbuch im Repo; der Container setzt `KOMPASS_HANDBOOK_DIR`. */
const REPO_HANDBOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/handbuch');

type Env = Pick<RuntimeEnv, 'handbookDir'>;

export interface HandbookPage {
  doc: string;
  title: string;
  /** Der Kurzabsatz direkt unter dem Titel, Markdown; leer, wenn keiner da ist. */
  lead: string;
  /** Alles nach der Titelzeile, Markdown — schließt den Kurzabsatz ein. */
  body: string;
}

export interface HandbookChapter {
  title: string;
  pages: { doc: string; title: string }[];
}

const DOC = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' };

export function handbookDir(env: Env): string {
  return env.handbookDir ?? REPO_HANDBOOK;
}

/** Ein Pfad unterhalb von `root`, oder null, wenn er hinausführt. */
function inside(root: string, rel: string): string | null {
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

/** Zeile 1 `# Titel`, dann der erste Absatz — nur wenn es ein Absatz ist, keine Überschrift, Liste, Bild, Zitat, Tabelle oder Code. */
export function parseHandbookPage(doc: string, markdown: string): HandbookPage {
  const lines = markdown.split('\n');
  const first = lines[0] ?? '';
  const title = first.startsWith('# ') ? first.slice(2).trim() : '';
  let i = 1;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  const paragraph: string[] = [];
  while (i < lines.length && lines[i]!.trim() !== '') paragraph.push(lines[i++]!);
  const head = paragraph[0] ?? '';
  const isParagraph = head !== '' && !/^(#|!\[|[-*+] |\d+\. |>|```|\||<)/.test(head);
  return { doc, title, lead: isParagraph ? paragraph.join('\n').trim() : '', body: lines.slice(1).join('\n').trim() };
}

export function readHandbookPage(env: Env, doc: string): HandbookPage | null {
  if (!DOC.test(doc) || doc === 'inhalt') return null;
  const file = inside(handbookDir(env), `${doc}.md`);
  if (!file || !existsSync(file)) return null;
  return parseHandbookPage(doc, readFileSync(file, 'utf8'));
}

export function readHandbookIndex(env: Env): string {
  const file = path.join(handbookDir(env), 'inhalt.md');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

/**
 * Die verschachtelte Liste aus `inhalt.md`: oberste Ebene ist ein Kapitel —
 * mit Link ist es zugleich seine einzige Seite —, eingerückte Einträge sind
 * seine Seiten.
 */
export function parseHandbookIndex(markdown: string): HandbookChapter[] {
  const chapters: HandbookChapter[] = [];
  for (const raw of markdown.split('\n')) {
    const m = /^(\s*)[-*]\s+(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const depth = m[1]!.length;
    const link = LINK.exec(m[2]!);
    const page = link ? { doc: link[2]!.replace(/\.md$/, ''), title: link[1]! } : null;
    if (depth === 0) chapters.push({ title: page ? page.title : m[2]!, pages: page ? [page] : [] });
    else if (page && chapters.length > 0) chapters.at(-1)!.pages.push(page);
  }
  return chapters;
}

/** `rel` ist der Pfad unterhalb von `bilder/`, wie er in `/help-bilder/<rel>` steht. */
export function readHandbookAsset(env: Env, rel: string): { bytes: Uint8Array; mimeType: string } | null {
  const ext = path.extname(rel).slice(1).toLowerCase();
  const mimeType = MIME[ext];
  if (!mimeType) return null;
  const root = path.join(handbookDir(env), 'bilder');
  const file = inside(root, rel);
  if (!file || file === path.resolve(root) || !existsSync(file)) return null;
  return { bytes: new Uint8Array(readFileSync(file)), mimeType };
}

export function listHandbookDocs(env: Env): string[] {
  const root = handbookDir(env);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === 'bilder' ? [] : walk(full);
      return name.endsWith('.md') ? [path.relative(root, full).replace(/\\/g, '/').replace(/\.md$/, '')] : [];
    });
  return existsSync(root) ? walk(root).filter((doc) => doc !== 'inhalt') : [];
}
