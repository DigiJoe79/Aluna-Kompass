import { describe, expect, it } from 'vitest';
import { channelKey } from '@/lib/finance/channel';

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
