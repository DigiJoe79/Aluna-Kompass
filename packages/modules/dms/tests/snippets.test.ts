import { describe, expect, it } from 'vitest';
import { createSnippet, deleteSnippet, listSnippets, updateSnippet } from '../src/snippets';
import { auditActions, setupWithTypes } from './helpers';

describe('Textbausteine', () => {
  it('legt an, listet sortiert, ändert, deaktiviert und löscht — mit Protokoll', async () => {
    const { deps, ctx } = setupWithTypes();
    const a = await createSnippet(deps, ctx, { name: 'Grußformel', body: 'Mit freundlichen Grüßen', sortOrder: 2 });
    const b = await createSnippet(deps, ctx, { name: 'Rückmeldung', subject: 'Bitte um Rückmeldung', body: 'Wir bitten um Rückmeldung bis …', sortOrder: 1 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const listed = await listSnippets(deps, ctx, {});
    expect(listed.ok && listed.value.map((s) => s.name)).toEqual(['Rückmeldung', 'Grußformel']);

    expect((await updateSnippet(deps, ctx, { id: a.value.id, isActive: false })).ok).toBe(true);
    const active = await listSnippets(deps, ctx, {});
    expect(active.ok && active.value.map((s) => s.name)).toEqual(['Rückmeldung']);
    const all = await listSnippets(deps, ctx, { includeInactive: true });
    expect(all.ok && all.value).toHaveLength(2);

    expect((await deleteSnippet(deps, ctx, { id: b.value.id })).ok).toBe(true);
    expect(auditActions(deps)).toEqual(expect.arrayContaining(['dms.snippet.create', 'dms.snippet.update', 'dms.snippet.delete']));
  });

  it('kein doppelter Name, kein leerer Text, kein Anlegen ohne Verwaltungsrecht', async () => {
    const { deps, ctx } = setupWithTypes();
    await createSnippet(deps, ctx, { name: 'Gruß', body: 'x' });
    const twice = await createSnippet(deps, ctx, { name: 'Gruß', body: 'y' });
    expect(!twice.ok && twice.error.type === 'conflict' && twice.error.code).toBe('snippetExists');
    const empty = await createSnippet(deps, ctx, { name: 'Leer', body: '' });
    expect(!empty.ok && empty.error.type).toBe('validation');
    const { ctx: writer } = setupWithTypes(['dms.view', 'dms.create']);
    const denied = await createSnippet(deps, writer, { name: 'Neu', body: 'x' });
    expect(!denied.ok && denied.error.type).toBe('forbidden');
    const missing = await updateSnippet(deps, ctx, { id: 'NOPE', name: 'x' });
    expect(!missing.ok && missing.error.type).toBe('notFound');
  });
});
