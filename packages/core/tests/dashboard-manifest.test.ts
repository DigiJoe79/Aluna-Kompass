import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { dashboardOptionFields, type DashboardTile } from '../src/dashboard/types';
import { defineModule } from '../src/modules/manifest';

const tile = (overrides: Partial<DashboardTile> = {}): DashboardTile => ({
  key: 'inbox',
  permission: 'test.view',
  kind: 'count',
  defaultOn: true,
  options: z.object({}),
  load: () => ({ kind: 'count', count: 0, href: null }),
  ...overrides,
});

const module = (tiles: DashboardTile[]) => defineModule({ key: 'test', version: '0', permissions: ['test.view'], dashboardTiles: tiles });

describe('dashboardOptionFields', () => {
  it('liest boolean, enum und integer samt Vorgaben aus dem Schema', () => {
    const fields = dashboardOptionFields(
      z.object({ onlyMine: z.boolean().default(false), horizonDays: z.enum(['7', '14', '30']).default('7'), rows: z.number().int().min(0).max(10).default(5) }),
    );
    expect(fields).toEqual([
      { name: 'onlyMine', type: 'boolean', default: false },
      { name: 'horizonDays', type: 'enum', values: ['7', '14', '30'], default: '7' },
      { name: 'rows', type: 'integer', min: 0, max: 10, default: 5 },
    ]);
  });

  it('liefert für z.object({}) keine Felder', () => {
    expect(dashboardOptionFields(z.object({}))).toEqual([]);
  });

  it('wirft bei Option ohne Vorgabe, bei fremdem Typ und bei Nicht-Objekt', () => {
    expect(() => dashboardOptionFields(z.object({ a: z.boolean() }))).toThrow(/without default: a/);
    expect(() => dashboardOptionFields(z.object({ a: z.string().default('x') }))).toThrow(/unsupported .*: a/);
    expect(() => dashboardOptionFields(z.object({ a: z.number().default(1.5) }))).toThrow(/unsupported .*: a/);
    expect(() => dashboardOptionFields(z.boolean())).toThrow(/object schema/);
  });
});

describe('defineModule with dashboardTiles', () => {
  it('nimmt eine gültige Kachel an', () => {
    expect(module([tile()]).dashboardTiles).toHaveLength(1);
  });

  it('lehnt doppelte Schlüssel ab', () => {
    expect(() => module([tile(), tile()])).toThrow(/duplicate dashboard tile: test\/inbox/);
  });

  it('lehnt einen Schlüssel ab, der nicht camelCase ist', () => {
    expect(() => module([tile({ key: 'in-box' })])).toThrow(/invalid dashboard tile key: in-box/);
  });

  it('lehnt ein Recht ab, das weder dem Modul noch dem Kern gehört', () => {
    expect(() => module([tile({ permission: 'other.view' })])).toThrow(/foreign permission: other.view/);
  });

  it('nimmt ein Kern-Recht an einer Modul-Kachel an', () => {
    expect(module([tile({ permission: 'followUps.view' })]).dashboardTiles).toHaveLength(1);
  });

  it('lehnt eine unzulässige Form ab', () => {
    expect(() => module([tile({ kind: 'chart' as never })])).toThrow(/invalid dashboard tile kind: chart/);
  });

  it('lehnt ein Optionsschema ohne Vorgabe ab', () => {
    expect(() => module([tile({ options: z.object({ a: z.boolean() }) })])).toThrow(/without default/);
  });
});
