// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DangerSection } from '@/components/forms/danger-section';

afterEach(cleanup);

describe('DangerSection', () => {
  it('nennt Titel, Satz und einen Outline-Knopf, der onAction ruft', () => {
    const onAction = vi.fn();
    render(<DangerSection title="Löschen" text="Entfernt das Tier." actionLabel="Löschen …" onAction={onAction} />);
    expect(screen.getByText('Löschen')).toBeTruthy();
    expect(screen.getByText('Entfernt das Tier.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Löschen …' });
    expect(button.className).toContain('border-line-strong'); // outline-Variante aus Charge 1
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalled();
  });

  it('trägt die Kennung am Knopf und steht als Abschnitt mit Überschrift da', () => {
    render(<DangerSection title="Archivieren" text="x" actionLabel="Deaktivieren" onAction={() => {}} testId="partner-delete-trigger" />);
    expect(screen.getByTestId('partner-delete-trigger').tagName).toBe('BUTTON');
    expect(screen.getByRole('heading', { name: 'Archivieren' })).toBeTruthy();
  });
});
