import { setSetting, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { membersModule } from '../src/manifest';
import { memberTypes } from '../src/schema';
import { auditOf, setupMembers } from './helpers';

describe('member type translations', () => {
  it('lists the member types with their name, inactive ones included', async () => {
    const { deps, ctx } = setupMembers();
    const list = unwrap(membersModule.translatables!(deps, ctx));
    expect(list.map((t) => [t.entityType, t.label, Object.keys(t.fields)])).toEqual([
      ['memberType', 'Ordentliches Mitglied', ['name']],
      ['memberType', 'Fördermitglied', ['name']],
      ['memberType', 'Ehrenmitglied', ['name']],
    ]);
  });

  it('writes only the named locale through saveMemberType, audited', async () => {
    const { deps, ctx } = setupMembers();
    await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
    const regular = deps.db.select().from(memberTypes).where(eq(memberTypes.key, 'regular')).get()!;
    unwrap(await membersModule.setTranslations!(deps, ctx, { entityType: 'memberType', id: regular.id, items: [{ field: 'name', locale: 'en', text: 'Regular member' }] })!);
    expect(deps.db.select().from(memberTypes).where(eq(memberTypes.id, regular.id)).get()!.name).toEqual({ de: 'Ordentliches Mitglied', en: 'Regular member' });
    expect(auditOf(deps, 'members.type.update')).toHaveLength(1);
  });
});
