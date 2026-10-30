// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { liveShortcut } from '@/lib/governance/shortcuts';

const key = (k: string, over: Partial<{ altKey: boolean; metaKey: boolean; ctrlKey: boolean; target: EventTarget | null }> = {}) => liveShortcut({ key: k, altKey: false, metaKey: false, ctrlKey: false, target: document.body, ...over });

describe('liveShortcut (Review Focus 4, N5)', () => {
  it('maps the keys without focus in a text field', () => {
    expect([key('e'), key('E'), key('z'), key('j'), key('a')]).toEqual(['unanimous', 'unanimous', 'count', 'accept', 'attendance']);
    expect(key('ArrowDown', { altKey: true })).toBe('next');
    expect(key('ArrowUp', { altKey: true })).toBe('prev');
  });

  it('types text in a textarea, a number field and contenteditable', () => {
    const area = document.createElement('textarea');
    const number = Object.assign(document.createElement('input'), { type: 'number' });
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.append(inner);
    for (const target of [area, number, inner]) {
      for (const k of ['e', 'z', 'j', 'a']) expect(key(k, { target })).toBeNull();
      expect(key('ArrowDown', { altKey: true, target })).toBeNull();
    }
  });

  it('without Alt the arrows do nothing; with Meta or Ctrl nothing', () => {
    expect(key('ArrowDown')).toBeNull();
    expect(key('e', { metaKey: true })).toBeNull();
    expect(key('e', { ctrlKey: true })).toBeNull();
  });
});
