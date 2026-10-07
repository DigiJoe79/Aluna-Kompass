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

/** K10 Charge 1, Spec § 3: sechs Rollen mit Größe, Zeilenhöhe und — bei Titeln — Gewicht. */
describe('Schriftrollen', () => {
  it.each([
    ['dialog-title', '19px', '1.25', '600'],
    ['section', '15px', '1.35', '600'],
    ['body', '14px', '1.5', null],
    ['meta', '13px', '1.45', null],
    ['hint', '12px', '1.4', null],
    ['figure', '32px', '1', null],
  ] as const)('%s', (role, size, leading, weight) => {
    expect(CSS).toContain(`--text-${role}: ${size};`);
    expect(CSS).toContain(`--text-${role}--line-height: ${leading};`);
    if (weight) expect(CSS).toContain(`--text-${role}--font-weight: ${weight};`);
    else expect(CSS).not.toContain(`--text-${role}--font-weight`);
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

  it('Dateiname im Mediendetail: Ausnahme mit Gewicht 500, gekürzt nur optisch', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/app/(shell)/admin/media/asset-detail-dialog.tsx'), 'utf8');
    const cls = /<DialogTitle className="([^"]+)">\{item\.filename\}/.exec(source)?.[1];
    expect(cls).toBe('truncate font-mono text-[14px] font-medium');
    const name = `${'ein-sehr-langer-dateiname-'.repeat(8)}.pdf`;
    render(<Dialog open><DialogContent size="md"><DialogTitle className={cls}>{name}</DialogTitle></DialogContent></Dialog>, { wrapper });
    const title = screen.getByRole('heading', { name });
    expect(title.textContent).toBe(name);
    expect(title.className.split(' ')).toEqual(expect.arrayContaining(['truncate', 'font-mono', 'text-[14px]', 'font-medium']));
    expect(title.className).not.toContain('text-dialog-title');
  });

  it.each(['admin/dms/types-panel.tsx', 'admin/dms/rules-panel.tsx'])('Löschdialog in %s erklärt die Folge in der Stufe body (K10 § 4.2)', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/app/(shell)', file), 'utf8');
    const at = source.search(/<DialogTitle>\{t\('delete(Type|Rule)Title'\)\}<\/DialogTitle>\s*<DialogDescription[^>]*>/);
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at).match(/<DialogDescription[^>]*>/)![0]).toBe('<DialogDescription tone="body">');
  });
});
