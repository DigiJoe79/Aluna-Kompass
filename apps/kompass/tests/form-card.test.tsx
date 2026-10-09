// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormCard, FormCardBody } from '@/components/forms/form-card';

afterEach(cleanup);

describe('FormCard', () => {
  it('schneidet mit overflow-clip, nie overflow-hidden — sonst klebt die Leiste nicht', () => {
    const { container } = render(<FormCard>Inhalt</FormCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.dataset.slot).toBe('form-card');
    expect(card.className).toContain('overflow-clip');
    expect(card.className).not.toContain('overflow-hidden');
    expect(card.className).toContain('rounded-lg border border-line bg-surface');
  });

  it('trägt die Marke am Ende, nach dem Inhalt', () => {
    const { container } = render(
      <FormCard>
        <FormCardBody>Inhalt</FormCardBody>
        <div data-testid="bar" />
      </FormCard>,
    );
    const card = container.firstElementChild as HTMLElement;
    expect((card.lastElementChild as HTMLElement).dataset.slot).toBe('form-card-end');
    expect(card.lastElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(card.firstElementChild?.className).toBe('p-5');
  });

  it('wählt das Element über as und reicht Attribute durch', () => {
    const { container } = render(
      <FormCard as="section" aria-labelledby="t" data-testid="karte">
        x
      </FormCard>,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.tagName).toBe('SECTION');
    expect(card.getAttribute('aria-labelledby')).toBe('t');
    expect(card.dataset.testid).toBe('karte');
    const form = render(<FormCard as="form">x</FormCard>).container.firstElementChild;
    expect(form?.tagName).toBe('FORM');
  });
});
