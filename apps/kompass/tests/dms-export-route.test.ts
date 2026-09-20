import { describe, expect, it } from 'vitest';
import { statusFor } from '@/app/dms/export/status';

describe('statusFor', () => {
  it('maps failures to HTTP', () => {
    expect(statusFor({ type: 'forbidden', permission: 'documents.export' })).toBe(403);
    expect(statusFor({ type: 'validation', issues: [] })).toBe(400);
    expect(statusFor({ type: 'conflict', code: 'bundleTooLarge', message: 'x' })).toBe(409);
    expect(statusFor({ type: 'notFound', entity: 'x', id: 'y' })).toBe(404);
  });
});
