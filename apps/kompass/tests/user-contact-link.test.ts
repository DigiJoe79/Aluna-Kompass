import { describe, expect, it } from 'vitest';
import { linkControls } from '@/lib/user-contact-link';

describe('linkControls', () => {
  const base = { moduleOn: true, canManageUsers: true, canViewContacts: true, isSelf: false, linked: false, hadLinkBefore: false };
  it('shows nothing when the module is off or the right is missing', () => {
    expect(linkControls({ ...base, moduleOn: false })).toBeNull();
    expect(linkControls({ ...base, canManageUsers: false })).toBeNull();
  });
  it('offers linking only with contacts.view', () => {
    expect(linkControls(base)).toEqual({ canLink: true, canUnlink: false, reason: null });
    expect(linkControls({ ...base, canViewContacts: false })).toEqual({ canLink: false, canUnlink: false, reason: 'needsContactsView' });
  });
  it('lets one link oneself once and never unlink oneself', () => {
    expect(linkControls({ ...base, isSelf: true })).toEqual({ canLink: true, canUnlink: false, reason: 'ownOnce' });
    expect(linkControls({ ...base, isSelf: true, hadLinkBefore: true })).toEqual({ canLink: false, canUnlink: false, reason: 'ownNeedsSecondPerson' });
    expect(linkControls({ ...base, isSelf: true, linked: true, hadLinkBefore: true })).toEqual({ canLink: false, canUnlink: false, reason: 'ownNeedsSecondPerson' });
    expect(linkControls({ ...base, linked: true, hadLinkBefore: true })).toEqual({ canLink: false, canUnlink: true, reason: null });
  });
});
