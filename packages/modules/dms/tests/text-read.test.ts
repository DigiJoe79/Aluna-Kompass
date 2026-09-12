import { describe, expect, it } from 'vitest';
import { replaceDocumentText } from '../src/index-store';
import { getDocumentText } from '../src/text';
import { fileFixture, setupWithTypes } from './helpers';

describe('getDocumentText', () => {
  it('liefert die Seiten aus dem Index, sobald gelesen wurde', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    replaceDocumentText(deps, letter.id, [{ page: 1, text: 'Seite eins' }, { page: 2, text: 'Seite zwei' }]);
    deps.sqlite.prepare(`update documents set text_status = 'done' where id = ?`).run(letter.id);
    const res = await getDocumentText(deps, ctx, { documentId: letter.id });
    expect(res.ok && res.value).toEqual({ textStatus: 'done', textError: null, pages: [{ page: 1, text: 'Seite eins' }, { page: 2, text: 'Seite zwei' }] });
  });

  it('sagt, warum nichts da ist, statt leer zu schweigen', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const res = await getDocumentText(deps, ctx, { documentId: letter.id });
    expect(res.ok && res.value.textStatus).toBe('pending');
    expect(res.ok && res.value.pages).toEqual([]);
    const { ctx: nobody } = setupWithTypes([]);
    expect((await getDocumentText(deps, nobody, { documentId: letter.id })).ok).toBe(false);
    const ghost = await getDocumentText(deps, ctx, { documentId: 'NOPE' });
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
  });
});
