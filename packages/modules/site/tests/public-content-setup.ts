import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, setModuleEnabled, unwrap } from '@kompass/core';
import { animalsModule } from '@kompass/module-animals';
import { projectsModule } from '@kompass/module-projects';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach } from 'vitest';
import { siteModule } from '../src/manifest';
import { applyTemplateSync } from '../src/service';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const templateDir = (source: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-pub-tpl-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'kompass.template.ts'), source);
  return dir;
};
const TEMPLATE = `
import { defineTemplate, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'X', locales: ['de'], uses: ['projects', 'animals'],
  variables: { claim: text({ localized: true, label: 'Claim' }) },
  collections: {
    notes: { label: 'Notizen', fields: { body: text({ label: 'Text' }) } },
    posts: { label: 'Beiträge', slug: true, publishable: true, fields: { title: text({ label: 'Titel' }) } },
  },
});`;

export const admin = ctxWith([
  'site.manage',
  'site.view',
  'site.publish',
  'modules.manage',
  'projects.manage',
  'projects.view',
  'animals.manage',
  'animals.view',
  'settings.manage',
]);

/** Webseite, Projekte und Tiere eingeschaltet, Template mit `uses: ['projects', 'animals']` eingelesen (Plan C). */
export async function setupPublicContent(locales = ['de']) {
  const deps = createTestDeps({ locales, manifests: [coreModule, projectsModule, animalsModule, siteModule] });
  insertUser(deps, { id: 'USER-TEST' });
  for (const key of ['site', 'projects', 'animals']) unwrap(await setModuleEnabled(deps, admin, { key, enabled: true }));
  unwrap(await applyTemplateSync(deps, admin, { dir: templateDir(TEMPLATE), confirm: true }));
  return deps;
}
export type SetupDeps = Awaited<ReturnType<typeof setupPublicContent>>;
