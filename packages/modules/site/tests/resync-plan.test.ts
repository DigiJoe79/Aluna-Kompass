import { describe, expect, it } from 'vitest';
import { losesContent, planResync, type Finding } from '../src/resync/plan';

const field = (widget: string, extra: Record<string, unknown> = {}) => ({ widget, ...extra });
const before = {
  name: 'T', locales: ['de', 'en'], uses: [],
  variables: { claim: field('localized', { label: 'Claim' }), subtitle: field('localized', { label: 'Untertitel' }), layout: { enum: ['narrow', 'wide', 'full'], label: 'Breite' } },
  collections: { metrics: { label: 'Kennzahlen', slug: false, sortable: true, publishable: false, max: 4, fields: { label: field('localized', { label: 'Bezeichnung' }), suffix: field('text', { label: 'Einheit' }) } } },
};
const after = {
  name: 'T', locales: ['de', 'en'], uses: [],
  variables: { claim: field('localized', { label: 'Claim' }), lede: field('localized', { label: 'Einleitung', renamedFrom: 'subtitle' }), layout: { enum: ['narrow', 'wide'], label: 'Breite' } },
  collections: { metrics: { label: 'Kennzahlen', slug: false, sortable: true, publishable: false, max: 2, fields: { label: field('localized', { label: 'Bezeichnung' }), suffix: { type: 'array', items: { type: 'string' }, label: 'Einheit' } } } },
};
const data = {
  variables: { claim: { de: 'A', en: 'B' }, subtitle: { de: 'Wer wir sind', en: '' }, layout: 'full' },
  collections: { metrics: [
    { label: { de: 'Mitglieder', en: 'Members' }, suffix: '' },
    { label: { de: 'Quote', en: '' }, suffix: '%' },
    { label: { de: 'Hunde', en: '' }, suffix: '' },
  ] },
};

const of = (kind: Finding['kind'], findings: Finding[]) => findings.filter((f) => f.kind === kind);

describe('planResync', () => {
  const findings = planResync(before as never, after as never, data);

  it('follows a declared rename and carries the content along', () => {
    expect(of('renamed', findings)).toEqual([{ kind: 'renamed', path: 'variables.lede', label: 'Einleitung', from: 'variables.subtitle', filled: 1 }]);
    expect(of('removed', findings)).toEqual([]);
  });

  it('says nothing about locales: a template cannot remove one', () => {
    const fewer = planResync(before as never, { ...after, locales: ['de'] } as never, data);
    expect(fewer.map((f) => f.kind)).toEqual(findings.map((f) => f.kind));
  });

  it('names the replacement for a value that is gone', () => {
    expect(of('valueGone', findings)).toEqual([{ kind: 'valueGone', path: 'variables.layout', label: 'Breite', value: 'full', count: 1, replacement: 'narrow' }]);
  });

  it('reports a tightened limit and a retype inside a collection', () => {
    expect(of('overLimit', findings)).toEqual([{ kind: 'overLimit', path: 'collections.metrics', label: 'Kennzahlen', have: 3, max: 2 }]);
    expect(of('retyped', findings)).toEqual([{ kind: 'retyped', path: 'collections.metrics[].suffix', label: 'Einheit', from: 'text', to: 'list', filled: 1, lossless: true }]);
  });

  it('asks for confirmation only where content is at stake', () => {
    // Umbenennung und verlustfreier Typwechsel kosten nichts; die Grenze und der
    // entfallene Aufzählungswert immer.
    expect(findings.filter(losesContent).map((f) => f.path).sort()).toEqual(
      ['collections.metrics', 'variables.layout'].sort(),
    );
  });

  it('treats an added field as harmless', () => {
    const plan = planResync(before as never, { ...after, variables: { ...after.variables, quote: field('localized', { label: 'Zitat' }) } } as never, data);
    expect(of('added', plan)).toEqual([{ kind: 'added', path: 'variables.quote', label: 'Zitat' }]);
    expect(of('added', plan).some(losesContent)).toBe(false);
  });
});
