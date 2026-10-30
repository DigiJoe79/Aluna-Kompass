import type { ModuleManifest } from '@kompass/core';
import { animalsModule } from '@kompass/module-animals';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { financeModule } from '@kompass/module-finance';
import { governanceModule } from '@kompass/module-governance';
import { membersModule } from '@kompass/module-members';
import { projectsModule } from '@kompass/module-projects';
import { siteModule } from '@kompass/module-site';

/**
 * Installierte Fachmodule dieser Installation. Aktivierung erfolgt unter Einrichtung → Module. Die Reihenfolge ist die
 * der Schiene (Mitglieder zwischen Kontakte und Akte, Handoff Mitglieder 2, N2); Einrichtung und Seed gehen nach
 * Abhängigkeiten (`installOrder`).
 */
export const installedModules: ModuleManifest[] = [siteModule, projectsModule, animalsModule, contactsModule, membersModule, dmsModule, financeModule, governanceModule];
