import { describe, expectTypeOf, it } from 'vitest';
import type { InferContent } from '@kompass/site-template';
import template from '../kompass.template';
import type { SiteContent } from '../src/lib/content';

/**
 * content.ts schreibt seine Typen nicht mehr ab. Ein umbenanntes Feld in der
 * Deklaration bricht damit `astro check`, bevor eine leere Seite gebaut wird.
 */
describe('content types', () => {
  it('follow the declaration', () => {
    expectTypeOf<SiteContent>().toEqualTypeOf<InferContent<typeof template>>();
    expectTypeOf<SiteContent['collections']['news'][number]['slug']>().toEqualTypeOf<string>();
    expectTypeOf<SiteContent['collections']['team'][number]['sortOrder']>().toEqualTypeOf<number>();
    expectTypeOf<SiteContent['variables']['memberFee']>().toEqualTypeOf<number | undefined>();
  });
});
