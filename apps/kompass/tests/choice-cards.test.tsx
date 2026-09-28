import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChoiceCards } from '@/components/choice-cards';

const options = [
  { value: 'a', label: 'Option A', description: 'Beschreibung A' },
  { value: 'b', label: 'Option B' },
];

describe('ChoiceCards (F7 Task 6a)', () => {
  it('renders a radiogroup in choice mode, with the selected value checked', () => {
    const markup = renderToStaticMarkup(<ChoiceCards mode="choice" name="status" legend="Status" options={options} value="a" onSelect={() => {}} />);
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('Option A');
    expect(markup).toContain('Beschreibung A');
    expect(markup).toMatch(/checked="?"?[^>]*value="a"/);
    expect(markup).not.toContain('dangerouslySetInnerHTML');
  });

  it('renders two independent buttons in action mode — never a radiogroup (A7, finance-cash.spec.ts stays unchanged)', () => {
    const markup = renderToStaticMarkup(<ChoiceCards mode="action" legend="Bar bezahlt?" options={options} onSelect={() => {}} />);
    expect(markup).not.toContain('role="radiogroup"');
    expect(markup.match(/<button\b/g)?.length).toBe(2);
    expect(markup).not.toContain('<input');
  });
});
