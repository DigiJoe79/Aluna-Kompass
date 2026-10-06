import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';

const SHADCN = /\b(bg-primary|text-primary-foreground|bg-secondary|text-secondary-foreground|bg-muted|text-foreground|bg-background|border-border|bg-destructive|text-destructive|bg-input|border-input)\b/;

describe('buttonVariants', () => {
  it.each(['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const)('%s nutzt nur Theme-Klassen', (variant) => {
    expect(buttonVariants({ variant })).not.toMatch(SHADCN);
  });
  it('setzt 600', () => expect(buttonVariants()).toContain('font-semibold'));
});
