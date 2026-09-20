import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { settings } from '../src/db/schema';
import { defineModule } from '../src/modules/manifest';
import { notifyRecordDeleted } from '../src/modules/record-hooks';
import { createTestDeps, ctxWith, TEST_NOW } from '../src/testing';

describe('notifyRecordDeleted', () => {
  it('tells every enabled module, inside the caller’s transaction, and no disabled one', () => {
    const seen: string[] = [];
    const on = defineModule({ key: 'on', version: '0', permissions: [], recordDeleted: (_tx, _d, ctx, type, id) => void seen.push(`on:${type}:${id}:${ctx.userId}`) });
    const off = defineModule({ key: 'off', version: '0', permissions: [], recordDeleted: () => void seen.push('off') });
    const deps = createTestDeps({ manifests: [coreModule, on, off] });
    deps.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(['on']), updatedAt: TEST_NOW }).run();
    deps.db.transaction((tx) => notifyRecordDeleted(tx, deps, ctxWith([], 'U1'), 'project', 'P1'));
    expect(seen).toEqual(['on:project:P1:U1']);
  });

  it('lets a throwing hook roll the deletion back', () => {
    const bad = defineModule({ key: 'bad', version: '0', permissions: [], recordDeleted: () => { throw new Error('nein'); } });
    const deps = createTestDeps({ manifests: [coreModule, bad] });
    deps.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(['bad']), updatedAt: TEST_NOW }).run();
    expect(() => deps.db.transaction((tx) => notifyRecordDeleted(tx, deps, ctxWith([]), 'project', 'P1'))).toThrow('nein');
  });
});
