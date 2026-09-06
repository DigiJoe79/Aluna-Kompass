import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearUploads, isUploadHandle, resolveUpload, uploadsDir } from '@/lib/setup-uploads';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-uploads-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('setup uploads', () => {
  it('puts the store next to the database', () => {
    expect(uploadsDir('/data/kompass.db')).toBe(path.join('/data', 'uploads'));
  });

  it('accepts only a ULID as a handle', () => {
    expect(isUploadHandle('01M1V39786ARW1M2PTG6YTWN8T')).toBe(true);
    expect(isUploadHandle('../../etc/passwd')).toBe(false);
    expect(isUploadHandle('01m1v39786arw1m2ptg6ytwn8t')).toBe(false);
    expect(isUploadHandle('')).toBe(false);
    expect(isUploadHandle('01M1V39786ARW1M2PTG6YTWN8T/x')).toBe(false);
  });

  it('resolves a valid handle inside the store and refuses anything else', () => {
    expect(resolveUpload('/data/kompass.db', '01M1V39786ARW1M2PTG6YTWN8T')).toBe(
      path.join('/data', 'uploads', '01M1V39786ARW1M2PTG6YTWN8T.tar.gz'),
    );
    expect(resolveUpload('/data/kompass.db', '../../etc/passwd')).toBeNull();
  });

  it('empties the store, so only one upload can ever occupy disk', async () => {
    const dbPath = path.join(tmp(), 'kompass.db');
    const store = await clearUploads(dbPath);
    writeFileSync(path.join(store, 'alt.tar.gz'), 'alt');
    await clearUploads(dbPath);
    expect(existsSync(path.join(store, 'alt.tar.gz'))).toBe(false);
    expect(existsSync(store)).toBe(true);
  });
});
