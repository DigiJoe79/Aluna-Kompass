// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { SectionNav } from '@/components/shell/section-nav';
import type { NavSection } from '@/lib/navigation';

afterEach(cleanup);

const item = (key: string, href: string, later?: boolean) => ({ key, href, icon: 'euro', labelKey: `nav.${key}`, disabled: false, visible: true, ...(later ? { later } : {}) });
const sections: NavSection[] = [{ key: 'finance.accountability', labelKey: 'nav.sections.finance.accountability', items: [item('finance.reports', '/finance/reports'), item('finance.fundUse', '/finance/fund-use', true)] }];

const renderNav = (activeHref: string | null) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <SectionNav sections={sections} activeHref={activeHref} variant="column" />
    </NextIntlClientProvider>,
  );

/** N1 (Freigabe Joe 2026-10-24): ein Eintrag „später“ ist ein normaler Link mit Zusatz, kein gesperrter. */
describe('SectionNav: Eintrag „später“', () => {
  it('ist ein Link mit Namen „…, folgt später“ und sichtbarem Zusatz', () => {
    renderNav(null);
    const later = screen.getByRole('link', { name: 'Mittelverwendung, folgt später' });
    expect(later.getAttribute('href')).toBe('/finance/fund-use');
    expect(later.textContent).toBe('Mittelverwendungspäter');
    const normal = screen.getByRole('link', { name: 'Berichte' });
    expect(normal.textContent).toBe('Berichte');
  });

  it('behält aktiv die Auswahl', () => {
    renderNav('/finance/fund-use');
    expect(screen.getByRole('link', { name: 'Mittelverwendung, folgt später' }).getAttribute('aria-current')).toBe('page');
  });
});
