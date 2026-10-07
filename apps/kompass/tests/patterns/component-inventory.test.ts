import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Die Oberfläche besteht aus den Bausteinen unter `src/components/` (AGENTS.md, „Oberfläche nur aus
 * bestehenden Bausteinen“). Dieser Wächter führt sie als Bestandsliste: Jede Datei steht mit dem
 * Abschnitt aus `docs/MUSTER.md`, dem sie gehört, und mit ihrer Freigabe. Eine neue Datei macht den
 * Test rot — nicht, um sie zu verbieten, sondern damit jemand sie einordnet und die Freigabe nennt
 * (Design-Handoff oder Zustimmung des Maintainers, mit Datum). Bis 0.2.5 waren so zwei Speicherleisten,
 * zwei Reiter-Navigationen, zwei Auswahlleisten und zwei Marken entstanden.
 *
 * Eine Datei in der Liste, die es nicht mehr gibt, macht den Test ebenfalls rot: Die Liste lügt sonst.
 */
const COMPONENTS = path.resolve(import.meta.dirname, '../../src/components');
const MUSTER = path.resolve(import.meta.dirname, '../../../../docs/MUSTER.md');

/** Abschnittskürzel → Überschrift in `docs/MUSTER.md`. */
const SECTIONS = {
  A: 'A — Meldungen',
  B: 'B — Speichern',
  C: 'C — Bearbeiten',
  D: 'D — Einstellungen',
  E: 'E — Formulare',
  F: 'F — Marken',
  G: 'G — Listen',
  I: 'I — Breiten',
  J: 'J — Formularraster',
  Seitenrahmen: 'Seitenrahmen',
  Fachbaustein: 'Fachbausteine und Grundbausteine',
  Grundbaustein: 'Fachbausteine und Grundbausteine',
} as const;
type Section = keyof typeof SECTIONS;

type Entry = readonly [section: Section, approval: string];
const bestand = (section: Section): Entry => [section, 'Bestand bis Fassung 0.2.5'];
const neu = (section: Section, approval: string): Entry => [section, approval];

const INVENTORY: Readonly<Record<string, Entry>> = {
  'auth-card.tsx': bestand('Seitenrahmen'),
  'before-after.tsx': bestand('A'),
  'blocked-state.tsx': bestand('Seitenrahmen'),
  'choice-cards.tsx': bestand('E'),
  'consequence-list.tsx': bestand('A'),
  'contact-picker.tsx': bestand('E'),
  'date-format-provider.tsx': bestand('Fachbaustein'),
  'drop-overlay.tsx': bestand('Fachbaustein'),
  'empty-state.tsx': bestand('G'),
  'finance/account-card.tsx': bestand('Fachbaustein'),
  'finance/amount-cell.tsx': bestand('Fachbaustein'),
  'finance/amount-field.tsx': bestand('Fachbaustein'),
  'finance/approval-detail-frame.tsx': bestand('Fachbaustein'),
  'finance/balance-indicator.tsx': bestand('Fachbaustein'),
  'finance/confirmation-section.tsx': bestand('Fachbaustein'),
  'finance/dated-value-row.tsx': bestand('Fachbaustein'),
  'finance/entry-state-badge.tsx': bestand('F'),
  'finance/invoice-card.tsx': bestand('Fachbaustein'),
  'finance/limit-progress.tsx': bestand('Fachbaustein'),
  'finance/lock-line.tsx': bestand('Fachbaustein'),
  'finance/partner-reason-prompt.tsx': bestand('Fachbaustein'),
  'finance/receipt-drop.tsx': bestand('Fachbaustein'),
  'finance/receipt-list.tsx': bestand('Fachbaustein'),
  'finance/split-row.tsx': bestand('Fachbaustein'),
  'finance/transfer-block.tsx': bestand('Fachbaustein'),
  'folder-column.tsx': bestand('Fachbaustein'),
  'folder-tree/announcements.ts': bestand('Fachbaustein'),
  'folder-tree/drag-preview.tsx': bestand('Fachbaustein'),
  'folder-tree/fixed-entry.tsx': bestand('Fachbaustein'),
  'folder-tree/folder-field.tsx': bestand('Fachbaustein'),
  'folder-tree/folder-move-dialog.tsx': bestand('Fachbaustein'),
  'folder-tree/folder-sheet.tsx': bestand('Fachbaustein'),
  'folder-tree/folder-tree-row.tsx': bestand('Fachbaustein'),
  'folder-tree/folder-tree.tsx': bestand('Fachbaustein'),
  'folder-tree/key-help.tsx': bestand('Fachbaustein'),
  'folder-tree/name-input-row.tsx': bestand('Fachbaustein'),
  'folder-tree/row-menu.tsx': bestand('Fachbaustein'),
  'folder-tree/type-ahead.ts': bestand('Fachbaustein'),
  'folder-tree/use-edge-scroll.ts': bestand('Fachbaustein'),
  'folder-tree/use-folder-tree-expanded.ts': bestand('Fachbaustein'),
  'folder-tree/use-undoable-moves.ts': bestand('Fachbaustein'),
  'forbidden-card.tsx': bestand('Seitenrahmen'),
  'forms/action-form.tsx': bestand('B'),
  'forms/confirm-dialog.tsx': bestand('A'),
  'forms/form-grid.tsx': neu('J', 'Handoff Konsistenz § 8b.1; Maintainer 2026-10-05'),
  'forms/danger-section.tsx': neu('C', 'Maintainer 2026-10-04 (Handoff Konsistenz § 3.3)'),
  'forms/delete-record-dialog.tsx': bestand('C'),
  'forms/field-error.tsx': bestand('A'),
  'forms/form-action-bar.tsx': bestand('B'),
  'forms/form-error-summary.tsx': bestand('A'),
  'forms/form-field.tsx': bestand('E'),
  'forms/localized-field.tsx': bestand('E'),
  'forms/media-picker.tsx': bestand('E'),
  'forms/publish-switch.tsx': bestand('C'),
  'forms/refusal-notice.tsx': neu('A', 'Handoff Konsistenz § 1; Maintainer 2026-10-04'),
  'forms/reorder-buttons.tsx': bestand('C'),
  'forms/save-status.tsx': bestand('B'),
  'forms/submit-button.tsx': bestand('B'),
  'forms/use-action-feedback.ts': neu('A', 'Handoff Konsistenz § 1; Maintainer 2026-10-04'),
  'forms/use-autosave.ts': bestand('B'),
  'gap-counter.tsx': bestand('Fachbaustein'),
  'guided-steps.tsx': bestand('Fachbaustein'),
  'handbook-toc.tsx': bestand('Fachbaustein'),
  'hydration-marker.tsx': bestand('Fachbaustein'),
  'key-chip.tsx': bestand('Fachbaustein'),
  'managed-field.tsx': bestand('E'),
  'markdown-preview.tsx': bestand('Fachbaustein'),
  'media/asset-grid.tsx': bestand('Fachbaustein'),
  'media/media-chooser-dialog.tsx': bestand('Fachbaustein'),
  'media/use-asset-drag.ts': bestand('Fachbaustein'),
  'module-inactive-card.tsx': bestand('Seitenrahmen'),
  'notice.tsx': bestand('A'),
  'page-header.tsx': bestand('Seitenrahmen'),
  'page.tsx': neu('I', 'Handoff Konsistenz § 8a.2; Maintainer 2026-10-05'),
  'panel-nav.tsx': neu('D', 'Handoff Konsistenz § 4.1'),
  'panel-nav-scroll.tsx': neu('D', 'Handoff Konsistenz § 4.1 (Telefon-Scroll); Hilfsteil der PanelNav, kein eigener Baustein'),
  'related-documents.tsx': bestand('Fachbaustein'),
  'requirement-list.tsx': bestand('Fachbaustein'),
  'schema-form/field.tsx': bestand('Fachbaustein'),
  'schema-form/index.tsx': bestand('Fachbaustein'),
  'schema-form/state.ts': bestand('Fachbaustein'),
  'section.tsx': neu('E', 'K10, Designer und Joe 2026-10-06'),
  'selection-bar.tsx': neu('G', 'Maintainer 2026-10-04 (SelectionBar für Journal und Akte)'),
  'shell/command-palette.tsx': bestand('Fachbaustein'),
  'shell/env-banner.tsx': bestand('Fachbaustein'),
  'shell/help-panel.tsx': bestand('Fachbaustein'),
  'shell/rail.tsx': bestand('Fachbaustein'),
  'shell/section-nav.tsx': bestand('Fachbaustein'),
  'shell/shell-frame.tsx': bestand('Fachbaustein'),
  'shell/topbar.tsx': bestand('Fachbaustein'),
  'shell/user-menu.tsx': bestand('Fachbaustein'),
  'site/site-job-indicator.tsx': bestand('Fachbaustein'),
  'site/site-job-provider.tsx': bestand('Fachbaustein'),
  'snippet-text.tsx': bestand('Fachbaustein'),
  'sortable-head.tsx': bestand('G'),
  'status-badge.tsx': bestand('F'),
  'ui/button.tsx': bestand('Grundbaustein'),
  'ui/checkbox.tsx': bestand('Grundbaustein'),
  'ui/command.tsx': bestand('Grundbaustein'),
  // `DialogDescription tone` (meta|body): K10, Designer und Joe 2026-10-07. Titelstandard: K10, 2026-10-06.
  'ui/dialog.tsx': bestand('Grundbaustein'),
  'ui/disclosure.tsx': bestand('Grundbaustein'),
  'ui/dropdown-menu.tsx': bestand('Grundbaustein'),
  'ui/input-group.tsx': bestand('Grundbaustein'),
  'ui/input.tsx': bestand('Grundbaustein'),
  'ui/label.tsx': bestand('Grundbaustein'),
  'ui/progress.tsx': bestand('Grundbaustein'),
  'ui/qr-code.tsx': bestand('Grundbaustein'),
  'ui/radio-group.tsx': neu('E', 'Handoff Konsistenz § 8c; Maintainer 2026-10-05 (zwei bis vier kurze Optionen statt nativer Radios)'),
  'ui/select.tsx': bestand('Grundbaustein'),
  'ui/separator.tsx': bestand('Grundbaustein'),
  // `SheetDescription tone` (meta|body): K10, Designer und Joe 2026-10-07. Polster von Kopf und Fuß 20 px: K10 § 4.6.
  'ui/sheet.tsx': bestand('Grundbaustein'),
  'ui/skeleton.tsx': bestand('Grundbaustein'),
  'ui/sonner.tsx': bestand('Grundbaustein'),
  'ui/switch.tsx': bestand('Grundbaustein'),
  // `TableEmpty`: K10, Designer und Joe 2026-10-06.
  'ui/table.tsx': bestand('G'),
  'ui/tabs.tsx': bestand('E'),
  'ui/textarea.tsx': bestand('Grundbaustein'),
  'ui/tooltip.tsx': bestand('Grundbaustein'),
  'user-contact-link-form.tsx': bestand('Fachbaustein'),
  'user-contact-link.tsx': bestand('Fachbaustein'),
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

const present = walk(COMPONENTS).map((file) => path.relative(COMPONENTS, file).split(path.sep).join('/'));

describe('Bausteine der Oberfläche', () => {
  it('jeder Baustein ist eingeordnet', () => {
    const unknown = present.filter((file) => !(file in INVENTORY));
    expect(
      unknown,
      'Neuer Baustein: in docs/MUSTER.md einordnen und Freigabe nennen (AGENTS.md) — Eintrag in INVENTORY dieses Tests mit Abschnitt und Freigabe.',
    ).toEqual([]);
  });

  it('die Liste nennt nur Bausteine, die es gibt', () => {
    expect(Object.keys(INVENTORY).filter((file) => !present.includes(file))).toEqual([]);
  });

  it('jeder Eintrag nennt eine Freigabe und einen Abschnitt, den MUSTER.md hat', () => {
    const muster = readFileSync(MUSTER, 'utf8');
    for (const [file, [section, approval]] of Object.entries(INVENTORY)) {
      expect(approval.trim(), `${file}: Freigabe fehlt`).not.toBe('');
      expect(muster, `${file}: Abschnitt „${SECTIONS[section]}“ fehlt in docs/MUSTER.md`).toMatch(new RegExp(`^## ${SECTIONS[section]}\\s*$`, 'm'));
    }
  });
});
