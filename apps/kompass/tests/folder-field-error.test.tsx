// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { FolderField } from '@/components/folder-tree/folder-field';
import messages from '../messages/de.json';

afterEach(cleanup);

const renderField = (errorId?: string) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <FolderField value={null} folders={[]} label="Ordner" emptyLabel="Eingangskorb" moveLabel="Ändern…" errorId={errorId} />
    </NextIntlClientProvider>
  );

describe('FolderField errorId', () => {
  it('verknüpft den Knopf mit der Fehlermeldung', () => {
    renderField('folder-error');
    const trigger = screen.getByRole('button', { name: 'Ändern…' });
    expect(trigger.getAttribute('aria-describedby')).toBe('folder-error');
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
  });

  it('lässt beides weg, solange kein Fehler ansteht', () => {
    renderField();
    const trigger = screen.getByRole('button', { name: 'Ändern…' });
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    expect(trigger.hasAttribute('aria-invalid')).toBe(false);
  });
});
