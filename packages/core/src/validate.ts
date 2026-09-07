import type { z } from 'zod';
import type { Deps } from './deps';
import { invalid, ok, type Result } from './result';

export function validate<T>(_deps: Deps, schema: z.ZodType<T>, input: unknown): Result<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  return invalid(
    parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}
