// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { MeetingWarnings, MEETING_WARNING_KEYS } from '@/app/(shell)/governance/meetings/[id]/meeting-warnings';

afterEach(cleanup);

const renderWarnings = (warnings: string[]) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages}>
      <MeetingWarnings warnings={warnings} />
    </NextIntlClientProvider>,
  );

describe('MeetingWarnings (G-25)', () => {
  it('shows each warning of the meeting and its findings as a warn notice, and nothing without', () => {
    renderWarnings(['startedOtherDay', 'minuteTakerAbsent', 'unknownInternal']);
    expect(screen.getAllByRole('status')).toHaveLength(2);
    cleanup();
    renderWarnings([]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('every key has a sentence', () => {
    const words = (messages as unknown as { governance: { meeting: { warnings: Record<string, string> } } }).governance.meeting.warnings;
    for (const key of MEETING_WARNING_KEYS) expect(words[key], key).toBeTruthy();
  });
});
