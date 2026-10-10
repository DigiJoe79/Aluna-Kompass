import { coreModule, readSetting, setSetting } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import {
  animalsModule,
  PHOTO_FRAME_KEY,
  photoFrameStyle,
  PROPOSAL_PHOTO_FOLDER_KEY,
  PROPOSAL_STACK_KEY,
  PROPOSALS_ENABLED_KEY,
  REVIEW_ON_MCP_WRITE_KEY,
  type PhotoFrame,
} from '../src';

const deps = () => {
  const d = createTestDeps({ manifests: [coreModule, animalsModule] });
  insertUser(d, { id: 'USER-TEST' });
  return d;
};
const admin = ctxWith(['settings.manage']);

/**
 * Das Format, in dem die Webseite das Hauptfoto zeigt, ist Sache des Templates. Die Maske zeigt die Fotos im
 * selben Ausschnitt, damit man beim Wählen des Hauptfotos sieht, was die Seite zeigt (Befund Joe, 2026-09-30).
 */
describe('photo frame setting', () => {
  it('defaults to 4:3 centred, as the mask showed it before', () => {
    expect(readSetting<PhotoFrame>(deps(), PHOTO_FRAME_KEY)).toEqual({ aspect: '4:3', focusX: 50, focusY: 50 });
  });

  it('takes a portrait frame with the focus in the upper part, and audits it', async () => {
    const d = deps();
    const written = await setSetting(d, admin, { key: PHOTO_FRAME_KEY, value: { aspect: '4:5', focusX: 50, focusY: 25 } });
    expect(written.ok).toBe(true);
    expect(readSetting<PhotoFrame>(d, PHOTO_FRAME_KEY)).toEqual({ aspect: '4:5', focusX: 50, focusY: 25 });
  });

  it('refuses a ratio that is none and a focus outside the picture', async () => {
    const d = deps();
    for (const value of [{ aspect: '0:5', focusX: 50, focusY: 50 }, { aspect: 'hoch', focusX: 50, focusY: 50 }, { aspect: '4:5', focusX: 50, focusY: 120 }, { aspect: '4:5', focusX: -1, focusY: 50 }]) {
      const res = await setSetting(d, admin, { key: PHOTO_FRAME_KEY, value });
      expect(res.ok === false && res.error.type === 'validation', JSON.stringify(value)).toBe(true);
    }
    expect((await setSetting(d, ctxWith([]), { key: PHOTO_FRAME_KEY, value: { aspect: '1:1', focusX: 50, focusY: 50 } })).ok).toBe(false);
  });

  it('turns the frame into the CSS the mask uses', () => {
    expect(photoFrameStyle({ aspect: '4:5', focusX: 50, focusY: 25 })).toEqual({ aspectRatio: '4 / 5', objectPosition: '50% 25%' });
  });
});

describe('proposal settings', () => {
  it('brings the proposal inbox, the review marker and the photo folder, all off or empty by default', () => {
    const d = deps();
    expect(readSetting(d, PROPOSALS_ENABLED_KEY)).toBe(false);
    expect(readSetting(d, REVIEW_ON_MCP_WRITE_KEY)).toBe(false);
    expect(readSetting(d, PROPOSAL_PHOTO_FOLDER_KEY)).toBe('');
    // Wisch-Stapel „Durchgehen“: vorerst abschaltbar, Vorgabe aus, bis er mit dem Verein bewertet ist (Joe 2026-10-10).
    expect(readSetting(d, PROPOSAL_STACK_KEY)).toBe(false);
  });
  it('accepts a valid folder path and refuses a broken one', async () => {
    const d = deps();
    expect((await setSetting(d, admin, { key: PROPOSAL_PHOTO_FOLDER_KEY, value: 'Fotos/Tiere' })).ok).toBe(true);
    expect((await setSetting(d, admin, { key: PROPOSAL_PHOTO_FOLDER_KEY, value: 'a//b' })).ok).toBe(false);
  });
});
