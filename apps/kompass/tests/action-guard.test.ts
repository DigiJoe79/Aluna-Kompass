import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', () => ({ getTranslations: async () => Object.assign((key: string) => key, { has: () => true }) }));

const APP = path.resolve(import.meta.dirname, '../src/app');

function actionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return actionFiles(full);
    return entry === 'actions.ts' ? [full] : [];
  });
}

/** Jede exportierte Server Action, die einen `ActionState` liefert, samt der Frage, ob ihr Rumpf mit `return guardAction(` beginnt. */
function stateActions(file: string): { name: string; guarded: boolean }[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: { name: string; guarded: boolean }[] = [];
  source.forEachChild((node) => {
    if (!ts.isFunctionDeclaration(node) || !node.name || !node.body) return;
    if (!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return;
    if (!node.type || !node.type.getText(source).includes('ActionState')) return;
    const first = node.body.statements[0];
    const guarded = node.body.statements.length === 1 && !!first && ts.isReturnStatement(first) && !!first.expression && ts.isCallExpression(first.expression) && first.expression.expression.getText(source) === 'guardAction';
    out.push({ name: node.name.text, guarded });
  });
  return out;
}

/**
 * Nachzügler der Prüfer-Nachrunde (Design-Nachtrag Phase 4, Task 6b): MCP fängt
 * rohe SQLite-Regelverstöße zentral ab (`guardConstraint`). Die Oberfläche tut
 * es jetzt ebenso — jede Server Action mit `ActionState` läuft durch
 * `guardAction` und liefert „databaseConstraint“ als Meldung, statt zu werfen.
 */
describe('Server Actions fangen Regelverstöße der Datenbank ab', () => {
  it('jede Datei actions.ts unter apps/kompass/src/app nutzt guardAction für jede Action mit ActionState', () => {
    const unguarded = actionFiles(APP).flatMap((file) => stateActions(file).filter((a) => !a.guarded).map((a) => `${path.relative(APP, file)}: ${a.name}`));
    expect(unguarded).toEqual([]);
  });

  it('guardAction macht aus einem SQLITE_CONSTRAINT eine Meldung und reicht alles andere weiter', async () => {
    const { guardAction } = await import('@/lib/action-guard');
    const error = Object.assign(new Error('FOREIGN KEY constraint failed'), { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(guardAction('test', async () => { throw error; })).resolves.toMatchObject({ status: 'error', code: 'databaseConstraint' });
    spy.mockRestore();
    await expect(guardAction('test', async () => ({ status: 'idle' as const }))).resolves.toEqual({ status: 'idle' });
    await expect(guardAction('test', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
