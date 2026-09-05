import { animalsModule } from '@kompass/module-animals';
import { websiteModule } from '@kompass/module-website';
import type { ModuleManifest } from '@kompass/core';

/** Installierte Fachmodule dieser Installation. Aktivierung erfolgt unter Verwaltung → Module. */
export const installedModules: ModuleManifest[] = [websiteModule, animalsModule];
