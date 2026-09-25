import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuidedSteps, guidedSteps, type GuidedStep } from '@/components/guided-steps';

/**
 * `GuidedSteps` (HANDOFF § 13.2, F6b Annahme 13): der waagrechte Schrittkopf —
 * erledigt, aktiv, offen; genau ein Schritt aktiv, und der trägt
 * `aria-current="step"`. Die Beschriftungen kommen vom Aufrufer.
 */
const STEPS: GuidedStep[] = [
  { key: 'select', label: 'Auswahl', state: 'done' },
  { key: 'preview', label: 'Vorschau', state: 'active' },
  { key: 'run', label: 'Lauf', state: 'todo' },
  { key: 'result', label: 'Ergebnis', state: 'todo' },
];

describe('GuidedSteps', () => {
  it('renders the steps in order as an ordered list, the active one with aria-current="step"', () => {
    const html = renderToStaticMarkup(createElement(GuidedSteps, { steps: STEPS }));
    expect(html).toMatch(/^<ol[^>]*data-testid="guided-steps"/);
    const items = [...html.matchAll(/<li([^>]*)>/g)].map((m) => m[1]!);
    expect(items).toHaveLength(4);
    expect(items.map((attrs) => /data-state="(\w+)"/.exec(attrs)![1])).toEqual(['done', 'active', 'todo', 'todo']);
    expect(items.filter((attrs) => attrs.includes('aria-current="step"'))).toHaveLength(1);
    expect(items[1]).toContain('aria-current="step"');
    expect(items[1]).toContain('data-testid="guided-step-preview"');
    const labels = ['Auswahl', 'Vorschau', 'Lauf', 'Ergebnis'].map((label) => html.indexOf(label));
    expect(labels.every((i, n) => i > 0 && (n === 0 || i > labels[n - 1]!))).toBe(true);
  });

  it('lays the steps out side by side', () => {
    const html = renderToStaticMarkup(createElement(GuidedSteps, { steps: STEPS }));
    expect(/^<ol class="([^"]*)"/.exec(html)![1]!.split(' ')).toContain('flex');
  });

  it('refuses anything but exactly one active step', () => {
    const none = STEPS.map((s) => ({ ...s, state: 'todo' as const }));
    const two = STEPS.map((s) => ({ ...s, state: 'active' as const }));
    expect(() => renderToStaticMarkup(createElement(GuidedSteps, { steps: none }))).toThrow(/exactly one active step/);
    expect(() => renderToStaticMarkup(createElement(GuidedSteps, { steps: two }))).toThrow(/exactly one active step/);
  });

  it('derives the states from the active key: done before, todo after', () => {
    expect(guidedSteps([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }], 'b').map((s) => s.state)).toEqual(['done', 'active', 'todo']);
    expect(() => guidedSteps([{ key: 'a', label: 'A' }], 'x')).toThrow(/exactly one active step/);
  });
});
