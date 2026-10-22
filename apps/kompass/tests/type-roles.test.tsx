// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { cn, TYPE_ROLES } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { read, relative, sourceFiles } from './patterns/source';

afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

const CSS = readFileSync(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');
const classes = (el: HTMLElement) => el.className.split(/\s+/);

/** K10 Charge 1, Spec § 3; Charge 3, Spec § 2 (Designer 2026-10-10): zehn Rollen. */
describe('Schriftrollen', () => {
  // Die Werte je Rolle stehen in `globals.css` und werden dort entschieden; hier nur, dass Rollen und CSS zusammenpassen.
  it('jede Rolle hat Größe und Zeilenhöhe, und jede Größe gehört zu einer Rolle', () => {
    const defined = [...new Set([...CSS.matchAll(/--text-([a-z-]+?)(?:--[a-z-]+)?:/g)].map((m) => m[1]!))];
    expect([...defined].sort()).toEqual([...TYPE_ROLES].sort());
    expect(TYPE_ROLES.filter((role) => !CSS.includes(`--text-${role}--line-height:`))).toEqual([]);
  });

  it('nur das Etikett trägt eine Sperrung', () => {
    expect(CSS).toContain('--text-label--letter-spacing: .04em;');
    expect([...CSS.matchAll(/--text-([a-z-]+)--letter-spacing/g)].map((m) => m[1])).toEqual(['label']);
  });

  it('b und strong haben 600, nicht bolder (Designer § 9.6)', () => {
    expect(CSS).toMatch(/@layer base\s*{[\s\S]*?b,\s*strong\s*{\s*font-weight:\s*600;\s*}/);
  });

  it('keine Rolle heißt wie eine Farbe — Tailwind nähme bei text-<name> die Farbe (text-key färbte statt zu setzen)', () => {
    const colors = new Set([...CSS.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]));
    expect(TYPE_ROLES.filter((role) => colors.has(role))).toEqual([]);
  });

  it('cn kennt genau die Rollen aus globals.css', () => {
    const roles = [...CSS.matchAll(/--text-([a-z]+(?:-[a-z]+)*): /g)].map((m) => m[1]);
    expect([...new Set(roles)].sort()).toEqual([...TYPE_ROLES].sort());
  });

  it.each([...TYPE_ROLES])('cn behält die Rolle %s neben einer Farbe (Review Focus 1)', (role) => {
    expect(cn(`text-${role} text-muted-ink`)).toBe(`text-${role} text-muted-ink`);
    expect(cn(`text-${role}`, 'text-ink-2')).toBe(`text-${role} text-ink-2`);
  });

  it('Rollen ersetzen sich gegenseitig, die spätere gewinnt', () => {
    expect(cn('text-meta', 'text-body')).toBe('text-body');
    expect(cn('text-meta text-muted-ink', 'text-body text-ink-2')).toBe('text-body text-ink-2');
    expect(cn('text-dialog-title', 'text-section')).toBe('text-section');
  });

  it('Rolle und Größe von Hand ersetzen sich ebenso, in beide Richtungen', () => {
    // Festgestellt 2026-10-07 mit cn 0.4: dieselbe Gruppe `font-size`, die spätere gewinnt.
    expect(cn('text-meta', 'text-[17px]')).toBe('text-[17px]');
    expect(cn('text-[17px]', 'text-meta')).toBe('text-meta');
    expect(cn('font-heading text-dialog-title text-ink', 'text-[17px]')).toBe('font-heading text-ink text-[17px]');
  });

  it('kein Baustein holt cn am konfigurierten vorbei', () => {
    expect(sourceFiles().filter((file) => /from ["']cn["']/.test(read(file))).map(relative)).toEqual([]);
  });
});

describe('Titel und Beschreibung', () => {
  it('DialogTitle trägt die Titelrolle ohne alte Klassen', () => {
    render(<Dialog open><DialogContent size="sm"><DialogTitle>Titel</DialogTitle></DialogContent></Dialog>, { wrapper });
    const title = classes(screen.getByRole('heading', { name: 'Titel' }));
    expect(title).toEqual(expect.arrayContaining(['font-heading', 'text-dialog-title', 'text-ink']));
    expect(title).not.toContain('leading-none');
    expect(title).not.toContain('text-base');
    expect(title).not.toContain('font-medium');
  });

  it('SheetTitle trägt die Titelrolle', () => {
    render(<Sheet open><SheetContent size="sm"><SheetTitle>Fenster</SheetTitle></SheetContent></Sheet>, { wrapper });
    expect(classes(screen.getByRole('heading', { name: 'Fenster' }))).toEqual(expect.arrayContaining(['font-heading', 'text-dialog-title', 'text-ink']));
  });

  it.each([
    ['Dialog', undefined, ['text-meta', 'text-muted-ink'], 'text-ink-2'],
    ['Dialog', 'body', ['text-body', 'text-ink-2'], 'text-muted-ink'],
    ['Sheet', undefined, ['text-meta', 'text-muted-ink'], 'text-ink-2'],
    ['Sheet', 'body', ['text-body', 'text-ink-2'], 'text-muted-ink'],
  ] as const)('%sDescription tone=%s', (kind, tone, has, hasNot) => {
    render(
      kind === 'Dialog' ? (
        <Dialog open><DialogContent size="sm"><DialogTitle>T</DialogTitle><DialogDescription tone={tone}>Satz</DialogDescription></DialogContent></Dialog>
      ) : (
        <Sheet open><SheetContent size="sm"><SheetTitle>T</SheetTitle><SheetDescription tone={tone}>Satz</SheetDescription></SheetContent></Sheet>
      ),
      { wrapper },
    );
    const description = classes(screen.getByText('Satz'));
    expect(description).toEqual(expect.arrayContaining([...has]));
    expect(description).not.toContain(hasNot);
    expect(description).not.toContain('text-sm');
  });

  it('Dateiname im Mediendetail: Rolle Text ohne Mono, gekürzt nur optisch (Designer 2026-10-10 § 9.6, Auftrag 5)', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/app/(shell)/admin/media/asset-detail-dialog.tsx'), 'utf8');
    const cls = /<DialogTitle className="([^"]+)">\{item\.filename\}/.exec(source)?.[1];
    expect(cls).toBe('truncate text-body');
    const name = `${'ein-sehr-langer-dateiname-'.repeat(8)}.pdf`;
    render(<Dialog open><DialogContent size="md"><DialogTitle className={cls}>{name}</DialogTitle></DialogContent></Dialog>, { wrapper });
    const title = screen.getByRole('heading', { name });
    expect(title.textContent).toBe(name);
    expect(title.className.split(' ')).toEqual(expect.arrayContaining(['truncate', 'text-body']));
    expect(title.className).not.toContain('font-mono');
    expect(title.className).not.toContain('font-medium');
    expect(title.className).not.toContain('text-dialog-title');
  });

  it.each(['admin/dms/types-panel.tsx', 'admin/dms/rules-panel.tsx'])('Löschdialog in %s erklärt die Folge in der Stufe body (K10 § 4.2)', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/app/(shell)', file), 'utf8');
    const at = source.search(/<DialogTitle>\{t\('delete(Type|Rule)Title'\)\}<\/DialogTitle>\s*<DialogDescription[^>]*>/);
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at).match(/<DialogDescription[^>]*>/)![0]).toBe('<DialogDescription tone="body">');
  });
});
