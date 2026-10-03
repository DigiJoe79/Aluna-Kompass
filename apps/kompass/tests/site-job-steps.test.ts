import type { SiteJobStep } from '@kompass/module-site';
import { describe, expect, it } from 'vitest';
import { stepCounter } from '@/lib/site-job-steps';

describe('stepCounter', () => {
  it.each([
    [{ key: 'images', state: 'running', done: 342, total: 1533 }, { key: 'count', values: { done: 342, total: 1533 } }],
    [{ key: 'transfer', state: 'running', done: 38, total: 61 }, { key: 'countFiles', values: { done: 38, total: 61 } }],
    [{ key: 'build', state: 'running', done: 86 }, { key: 'pages', values: { count: 86 } }],
    [{ key: 'build', state: 'done', done: 86 }, { key: 'pages', values: { count: 86 } }],
    [{ key: 'images', state: 'done', done: 1533, total: 1533 }, { key: 'variants', values: { count: 1533 } }],
    [{ key: 'checksums', state: 'done', done: 61, total: 61 }, { key: 'files', values: { count: 61 } }],
    [{ key: 'targetFiles', state: 'running', done: 120 }, { key: 'files', values: { count: 120 } }],
    [{ key: 'images', state: 'running', done: 12 }, { key: 'number', values: { count: 12 } }],
    [{ key: 'checksums', state: 'pending' }, null],
    [{ key: 'export', state: 'skipped' }, null],
    [{ key: 'build', state: 'skipped', done: 1200, total: 4113 }, { key: 'reusing', values: { done: 1200, total: 4113 } }],
    [{ key: 'build', state: 'skipped', done: 4113, total: 4113 }, null],
  ] as const)('%o', (step, expected) => expect(stepCounter(step as SiteJobStep)).toEqual(expected));
});
