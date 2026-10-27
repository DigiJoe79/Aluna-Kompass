import { describe, expect, it } from 'vitest';
import { keepSectionSign } from '../src/format';

describe('keepSectionSign', () => {
  it('setzt nach § und §§ ein geschütztes Leerzeichen, sonst nichts', () => {
    expect(keepSectionSign('nach § 13b UStG')).toBe('nach § 13b UStG');
    expect(keepSectionSign('§§ 51, 59 AO und § 60a')).toBe('§§ 51, 59 AO und § 60a');
    expect(keepSectionSign('ohne Paragraf')).toBe('ohne Paragraf');
  });
});
