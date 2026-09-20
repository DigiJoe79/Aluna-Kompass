import { describe, expect, it } from 'vitest';
import { DMS_MCP_TOOLS } from '@kompass/module-dms';
import { setupWithArea } from '../../../packages/modules/dms/tests/helpers';

/** Jedes lesende Werkzeug der Akte, mit einer Eingabe, die das geschützte Dokument träfe. */
const READS: Record<string, (ids: { secretId: string }) => unknown> = {
  dms_list: () => ({ text: 'geheimer' }),
  dms_get: ({ secretId }) => ({ id: secretId }),
  dms_text: ({ secretId }) => ({ documentId: secretId }),
  dms_folders: () => ({}),
  dms_count_type: () => ({ key: 'secret' }),
  dms_preview_reclassification: ({ secretId }) => ({ id: secretId, typeKey: 'letter', documentDate: '2026-09-01' }),
};

describe('MCP and protected document types', () => {
  it('no reading tool hands the subject to a caller with dms.view only', async () => {
    const { deps, viewer, secretId } = await setupWithArea();
    for (const [name, input] of Object.entries(READS)) {
      const tool = DMS_MCP_TOOLS.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      const result = await tool!.handler(deps, viewer, input({ secretId }));
      expect(JSON.stringify(result), name).not.toContain('Streng geheimer Betreff');
    }
  });

  it('the list above names every reading tool of the file module', () => {
    const writing = /_(create|update|delete|file|receive|reclassify|link|unlink|relate|unrelate|move|void|dispatch|add|reindex)/;
    const reading = DMS_MCP_TOOLS.map((t) => t.name).filter((n) => !writing.test(n) && !['dms_types', 'dms_rules', 'dms_snippets', 'dms_suggest_classification', 'dms_areas'].includes(n));
    expect(reading.sort()).toEqual(Object.keys(READS).sort());
  });
});
