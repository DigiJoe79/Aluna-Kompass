import { describe, expect, it } from 'vitest';
import { channelKey, historyChannel } from '@/lib/finance/channel';

describe('channelKey', () => {
  it('maps ui, mcp and system to themselves and anything else to unknown, never to ui', () => {
    expect(channelKey('ui')).toBe('ui');
    expect(channelKey('mcp')).toBe('mcp');
    expect(channelKey('system')).toBe('system');
    expect(channelKey(null)).toBe('unknown');
    expect(channelKey('')).toBe('unknown');
    expect(channelKey('anything-else')).toBe('unknown');
  });
});

describe('historyChannel', () => {
  it('shows the channel for created and finalized, mapping unknown values to unknown', () => {
    expect(historyChannel({ kind: 'created', channel: 'mcp' })).toBe('mcp');
    expect(historyChannel({ kind: 'finalized', channel: 'system' })).toBe('system');
    expect(historyChannel({ kind: 'finalized', channel: 'fax' })).toBe('unknown');
  });

  it('shows no channel where the service knows none: reviewed (human only) and events without a channel field', () => {
    expect(historyChannel({ kind: 'reviewed', channel: null })).toBeNull();
    expect(historyChannel({ kind: 'reversed' })).toBeNull();
    expect(historyChannel({ kind: 'voucherAdded' })).toBeNull();
  });

  it('a finalized event with a null channel is unknown, never ui', () => {
    expect(historyChannel({ kind: 'finalized', channel: null })).toBe('unknown');
  });
});
