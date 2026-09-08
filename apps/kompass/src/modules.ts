import type { ModuleManifest } from '@kompass/core';
import { animalsModule } from '@kompass/module-animals';
import { siteModule } from '@kompass/module-site';

/** Installierte Fachmodule dieser Installation. Aktivierung erfolgt unter Verwaltung → Module. */
export const installedModules: ModuleManifest[] = [siteModule, animalsModule];
