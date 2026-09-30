import { describe, expect, it } from 'vitest';
import { queuePosition } from '../src/lib/queue-position';

describe('queuePosition', () => {
  it('nennt Platz, Vorgänger und Nachfolger', () => {
    expect(queuePosition(['a', 'b', 'c'], 'b')).toEqual({ index: 2, total: 3, previousId: 'a', nextId: 'c' });
  });

  it('kennt am Anfang keinen Vorgänger und am Ende keinen Nachfolger', () => {
    expect(queuePosition(['a', 'b', 'c'], 'a')).toEqual({ index: 1, total: 3, previousId: null, nextId: 'b' });
    expect(queuePosition(['a', 'b', 'c'], 'c')).toEqual({ index: 3, total: 3, previousId: 'b', nextId: null });
    expect(queuePosition(['a'], 'a')).toEqual({ index: 1, total: 1, previousId: null, nextId: null });
  });

  it('liefert null, wenn die ID nicht (mehr) in der Auswahl steht', () => {
    expect(queuePosition(['a', 'b'], 'x')).toBeNull();
    expect(queuePosition([], 'x')).toBeNull();
  });
});
