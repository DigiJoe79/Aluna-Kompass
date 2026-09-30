import { describe, expect, it } from 'vitest';
import { storyChanged } from '../src/app/(shell)/animals/story-changed';

const saved = { beforeAssetId: 'A1', afterAssetId: null, quote: { de: 'Endlich zuhause.', en: '' }, family: 'Familie M.', adoptedYear: 2026, beforeCaption: {}, afterCaption: { de: 'Zuhause' } };

describe('storyChanged', () => {
  it('sieht keinen Unterschied, wo keiner ist – leere Sprachfelder zählen nicht', () => {
    expect(storyChanged(saved, { ...saved, quote: { de: 'Endlich zuhause.' }, beforeCaption: { de: '', en: '' }, afterCaption: { en: '', de: 'Zuhause' } })).toBe(false);
  });

  it('erkennt jede Änderung', () => {
    expect(storyChanged(saved, { ...saved, family: 'Familie K.' })).toBe(true);
    expect(storyChanged(saved, { ...saved, adoptedYear: 2025 })).toBe(true);
    expect(storyChanged(saved, { ...saved, beforeAssetId: null })).toBe(true);
    expect(storyChanged(saved, { ...saved, afterAssetId: 'A2' })).toBe(true);
    expect(storyChanged(saved, { ...saved, quote: { de: 'Anders.' } })).toBe(true);
    expect(storyChanged(saved, { ...saved, beforeCaption: { en: 'At the foster home' } })).toBe(true);
  });

  it('ohne gespeicherte Geschichte ist jede Eingabe eine Änderung', () => {
    expect(storyChanged(null, saved)).toBe(true);
  });
});
