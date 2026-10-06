import { describe, expect, it } from 'vitest';
import { profileUrl } from '../src/profile-url';
import { profileUrlSchema } from '../src/settings';

describe('profileUrl', () => {
  it('replaces every {slug} and encodes the slug', () => {
    expect(profileUrl('https://example.org/tiere/{slug}/', 'mika')).toBe('https://example.org/tiere/mika/');
    expect(profileUrl('https://example.org/{slug}?s={slug}', 'a b')).toBe('https://example.org/a%20b?s=a%20b');
  });

  it('gives null without a template or without the placeholder', () => {
    expect(profileUrl('', 'mika')).toBeNull();
    expect(profileUrl('https://example.org/tiere/', 'mika')).toBeNull();
  });
});

describe('profileUrlSchema', () => {
  it('accepts empty and an http(s) address with {slug}, nothing else', () => {
    expect(profileUrlSchema.safeParse('').success).toBe(true);
    expect(profileUrlSchema.safeParse('https://example.org/tiere/{slug}/').success).toBe(true);
    expect(profileUrlSchema.safeParse('https://example.org/tiere/').success).toBe(false);
    expect(profileUrlSchema.safeParse('ftp://example.org/{slug}').success).toBe(false);
    expect(profileUrlSchema.safeParse('https://example.org/ {slug}').success).toBe(false);
  });
});
