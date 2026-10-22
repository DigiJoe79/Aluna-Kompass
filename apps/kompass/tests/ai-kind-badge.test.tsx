// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { AiKindBadge } from '@/components/media/ai-kind-badge';

afterEach(cleanup);

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );

describe('AiKindBadge', () => {
  it('renders nothing when kind is none or undefined', () => {
    const { container } = wrap(<AiKindBadge kind="none" />);
    expect(container.firstChild).toBeNull();
    const { container: emptyContainer } = wrap(<AiKindBadge kind={undefined} />);
    expect(emptyContainer.firstChild).toBeNull();
  });

  it('names each kind with its own word', () => {
    wrap(<AiKindBadge kind="edited" />);
    const edited = screen.getByTestId('ai-kind-badge').textContent;
    cleanup();
    wrap(<AiKindBadge kind="generated" />);
    const generated = screen.getByTestId('ai-kind-badge').textContent;
    expect(edited).toBe(messages.media.aiKind.badgeEdited);
    expect(generated).toBe(messages.media.aiKind.badgeGenerated);
    expect(edited).not.toBe(generated);
  });
});
