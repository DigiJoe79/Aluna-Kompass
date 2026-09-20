import type { Failure } from '@kompass/core';

export function statusFor(error: Failure['error']): number {
  return error.type === 'forbidden' ? 403 : error.type === 'validation' ? 400 : error.type === 'conflict' ? 409 : 404;
}
