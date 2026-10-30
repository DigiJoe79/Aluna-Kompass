// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { InvitationRunPreview } from '@kompass/module-governance';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/governance/meetings/[id]/actions', () => ({ startInvitationRunAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { InvitationStart } = await import('@/app/(shell)/governance/meetings/[id]/invitation/invitation-start');

afterEach(cleanup);

const preview = { recipients: [{ membershipId: 'ms1', contactId: 'c1', memberNumber: '1', channel: 'post', hasVotingRight: true, refusal: null }], warnings: [] } as unknown as InvitationRunPreview;
const footerText = (agentsAllowed: boolean) => {
  render(
    <NextIntlClientProvider locale="de" messages={messages}>
      <InvitationStart meetingId="m1" kind="invitation" preview={preview} names={{ c1: 'Erika Muster' }} canStart agentsAllowed={agentsAllowed} />
    </NextIntlClientProvider>,
  );
  return screen.getByTestId('invitation-footer').textContent ?? '';
};

describe('InvitationStart: the hint that only a human issues follows governance.mcpHumanOnlyAllowed', () => {
  it('names the human-only rule while agents may not issue', () => {
    expect(footerText(false)).toContain(messages.governance.invite.run.humanOnly);
  });

  it('says nothing about it when the association lets agents issue', () => {
    expect(footerText(true)).not.toContain(messages.governance.invite.run.humanOnly);
  });
});
