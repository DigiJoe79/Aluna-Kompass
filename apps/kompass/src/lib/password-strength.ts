export function strengthSegments(password: string): number {
  if (password.length === 0) return 0;
  if (password.length < 12) return 1;
  if (password.length < 16) return 2;
  if (password.length < 20) return 3;
  return 4;
}
