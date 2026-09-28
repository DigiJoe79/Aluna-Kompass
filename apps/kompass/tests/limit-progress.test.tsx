import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LimitProgress, limitState } from '@/components/finance/limit-progress';

describe('LimitProgress (F7 Task 6a, Design 4h)', () => {
  it('shows the label given by the caller and a bar at the covered share', () => {
    const markup = renderToStaticMarkup(<LimitProgress coveredCents={4500} totalCents={10000} label="belegt 45,00 € von 100,00 €" />);
    expect(markup).toContain('belegt 45,00 € von 100,00 €');
    expect(markup).toContain('aria-label="belegt 45,00 € von 100,00 €"');
    expect(markup).not.toContain('dangerouslySetInnerHTML');
  });

  it('never exceeds full and never goes negative for an odd input', () => {
    expect(() => renderToStaticMarkup(<LimitProgress coveredCents={20000} totalCents={10000} label="x" />)).not.toThrow();
    expect(() => renderToStaticMarkup(<LimitProgress coveredCents={0} totalCents={0} label="x" />)).not.toThrow();
  });
});

describe('limitState and the state word (F8b Annahme 17, Design 4h)', () => {
  it('is calm below warnAtPercent, near from it, exceeded above the limit', () => {
    expect(limitState({ valueCents: 70000, limitCents: 96000, warnAtPercent: 80, kind: 'limit' })).toBe('calm');
    expect(limitState({ valueCents: 76800, limitCents: 96000, warnAtPercent: 80, kind: 'limit' })).toBe('near');
    expect(limitState({ valueCents: 96000, limitCents: 96000, warnAtPercent: 80, kind: 'limit' })).toBe('near');
    expect(limitState({ valueCents: 96001, limitCents: 96000, warnAtPercent: 80, kind: 'limit' })).toBe('exceeded');
  });

  it('knows no state without a limit, and reached for a target', () => {
    expect(limitState({ valueCents: 5, limitCents: 0, warnAtPercent: 80, kind: 'limit' })).toBeNull();
    expect(limitState({ valueCents: 5000, limitCents: 10000, warnAtPercent: 80, kind: 'target' })).toBe('calm');
    expect(limitState({ valueCents: 10000, limitCents: 10000, warnAtPercent: 80, kind: 'target' })).toBe('reached');
  });

  it('renders the caller’s state word as a badge, the mono figure and the rest sentence, with one bar only', () => {
    const markup = renderToStaticMarkup(
      <LimitProgress coveredCents={100000} totalCents={96000} label="Ehrenamtspauschale" state="exceeded" stateLabel="überschritten" figure="1.000,00 € von 960,00 €" remainder="Die Grenze ist um 40,00 € überschritten." />,
    );
    expect(markup).toContain('überschritten');
    expect(markup).toContain('data-state="exceeded"');
    expect(markup).toContain('1.000,00 € von 960,00 €');
    expect(markup).toContain('Die Grenze ist um 40,00 € überschritten.');
    expect(markup.match(/data-slot="progress-track"/g)).toHaveLength(1);
  });
});
