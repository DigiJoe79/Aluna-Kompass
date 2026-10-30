import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { defineModule } from '../src/modules/manifest';
import { publishedItemLiveSince, resolvePublishedFile } from '../src/published/files';
import { writeSettingInternal } from '../src/settings/service';
import { createTestDeps, systemContext } from '../src/testing';

const bytes = new TextEncoder().encode('%PDF-1.4');
const files = defineModule({
  key: 'akten',
  version: '1',
  permissions: [],
  publishedFile: (_deps, id) => (id.startsWith('akten.') ? { id, filename: 'bericht-2026.pdf', mimeType: 'application/pdf', read: async () => bytes } : null),
});
const web = defineModule({ key: 'netz', version: '1', permissions: [], publishedLiveSince: (_deps, view, href) => (view === 'v' && href === '/x' ? '2026-09-01T10:00:00.000Z' : null) });

function withModules(enabled: string[]) {
  const deps = createTestDeps({ manifests: [coreModule, files, web] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', enabled));
  return deps;
}

describe('Dateien aus Modulen für die Webseite', () => {
  it('liefert die Datei des Moduls, das die ID erkennt; sonst null', async () => {
    const deps = withModules(['akten', 'netz']);
    const file = resolvePublishedFile(deps, 'akten.123');
    expect(file).toMatchObject({ id: 'akten.123', filename: 'bericht-2026.pdf', mimeType: 'application/pdf' });
    expect(await file!.read()).toEqual(bytes);
    expect(resolvePublishedFile(deps, 'fremd.123')).toBeNull();
  });

  it('fragt kein ausgeschaltetes Modul', () => {
    expect(resolvePublishedFile(withModules(['netz']), 'akten.123')).toBeNull();
  });
});

describe('Publiziert seit', () => {
  it('fragt das Webseiten-Modul; ohne es null', () => {
    expect(publishedItemLiveSince(withModules(['akten', 'netz']), 'v', '/x')).toBe('2026-09-01T10:00:00.000Z');
    expect(publishedItemLiveSince(withModules(['akten', 'netz']), 'v', '/y')).toBeNull();
    expect(publishedItemLiveSince(withModules(['akten']), 'v', '/x')).toBeNull();
  });
});
