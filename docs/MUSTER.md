# Muster — wie Kompass-Seiten gebaut werden

Gilt für jede neue Seite und jedes neue Modul, für Menschen wie für Agenten: **Vor jeder neuen Seite oder jedem neuen Modul dieses Dokument lesen.** Die Oberfläche besteht aus den Bausteinen unter `apps/kompass/src/components/`; wer einen neuen Baustein oder eine neue Variante eines vorhandenen braucht (Leiste, Marke, Tabelle, Reiter, Meldung, Dialogfuß, Knopf), braucht dafür eine ausdrückliche Freigabe — siehe `AGENTS.md`, „Oberfläche nur aus bestehenden Bausteinen“.

Abweichungen von den Mustern stehen nur in der Erlaubnisliste des jeweiligen Wächter-Tests (`apps/kompass/tests/patterns/`), je Zeile mit Begründung. Das Diff zeigt sie, also sieht sie das Review. Herkunft: Fassung 0.2.6 (Konsistenz).

Vorlage zum Abschreiben: das Modul **Projekte** — Liste `apps/kompass/src/app/(shell)/projects/page.tsx`, Anlegen und Detail `projects/[id]/page.tsx` (die Kennung `new` legt an), Formular `projects/project-form.tsx`, Löschen `projects/delete-project.tsx`. Für eine Einstellungsseite mit Unterbereichen: `admin/settings/` (Reiter in der Adresse).

## A — Meldungen

- **Feld ungültig** → `FormField error` am Feld und `FormErrorSummary` oben.
- **Der Dienst lehnt ab** → der `ActionState` (`status: 'error'` mit `message`, optional `title`, `detail` und ein bis drei `remedies`) geht an `FormActionBar state`, `ConfirmDialog` oder — für Knöpfe, Menüs und Listen — an `RefusalNotice` über dem Auslöser. Ein Dialog bleibt bei Ablehnung offen und nennt den Grund. **Kein `toast.error`.**
- **Knopf ohne Formular** (Menü, Schalter in einer Zeile, Aktion im Dialog): `useActionFeedback()` liefert `{ state, run, reset }`; `run(() => action())` hält die Ablehnung, `RefusalNotice` zeigt sie über der Liste oder dem Knopf.
- **Kein Platz über dem Auslöser** (Listen-Schalter, Reihenfolge-Pfeile, Kachelhäkchen, Ziehen und Ablegen): `toastRefusal(state)` aus `lib/feedback.ts` — der Toast bleibt, bis man ihn schließt. Das ist die Ausnahme; jede Stelle steht mit Begründung in der Erlaubnisliste von `no-refusal-toast.test.ts`.
- **Netz gescheitert** (die Server Action warf): `runAction` macht daraus `kind: 'network'`; `useActionFeedback` zeigt einen Toast ohne Zeitlimit mit „Erneut versuchen“ (`run(fn, { retry })`). Gerätefehler (Kopieren) und Netzfehler beim Herunterladen gehen ebenso in einen Toast mit Schließen-Knopf. Grenze: Eine `<form action>`-Maske (`useActionState`/`ActionForm`) fängt React nicht ab; dort geht ein Wurf an die Fehlergrenze.
- **Feldfehler, den die Maske nicht zeigen kann** → `withUnplacedFieldErrors(state, [Felder, die sie zeigt])` macht daraus eine Ablehnung über der Leiste, statt dass nichts erscheint.
- **Veralteter Stand** → der Konflikt-Satz („Der Eintrag wurde inzwischen geändert“) mit den Auswegen „Ihre Änderungen neben den neuen Stand legen“ und „Neuen Stand laden“ (`lib/conflict-remedies.ts`); die Leiste zeigt ihn selbst.
- **Warnung ohne Sperre** → `Notice level="warn"` an der betroffenen Stelle; Hinweis → `level="hint"`.
- **Erfolg** → `toast.success`.
- Ablehnungen nennen den Grund und bis zu drei Auswege, nie das Wort „Fehler“. Jede Ablehnung steht an der Stelle, an der man gehandelt hat.

Bausteine: `forms/form-error-summary.tsx`, `forms/field-error.tsx`, `forms/refusal-notice.tsx`, `forms/use-action-feedback.ts`, `forms/confirm-dialog.tsx`, `lib/feedback.ts`, `notice.tsx`.

## B — Speichern

- Immer `FormActionBar`, als **letztes Kind** der Formularkarte bzw. des Dialogs. Sie gehört in das `<form>` und liest den Stand von dort.
- `mode`: `edit` (Standard; ohne Änderung sagt sie „Nichts geändert“), `create` (schickt immer ab, der Dienst nennt die Pflichtfelder), `run` (eine Aktion ausführen, ohne Zähler).
- `placement`: `page` klebt am unteren Rand, `dialog` klebt nichts (gilt, sobald `cancel` gesetzt ist). Ein Dialog mit eigenem Rand setzt `--dialog-pad` selbst (`[--dialog-pad:0px]` bei `p-0`, `1.5rem` bei `p-6`); `layout="fixed-footer"` am Dialog hält Kopf und Leiste fest und lässt die Mitte (`DialogBody`) scrollen — nötig, sobald die Maske höher werden kann als ein Fenster.
- Ohne `<form>` (Dialog mit eigenem Zustand): `onSave` und `pending`; gezählt wird über `count`.
- Linke Zeile über Props: `note` (Freigeber, Protokoll, Pflichtfeld-Legende), `status` (Zwischenstand laufend gesicherter Masken), sonst zählt die Leiste selbst. `destructive` macht den Hauptknopf zum Löschknopf; `testId`/`saveTestId` sind Kennungen für Tests.
- Speichern ist nie ausgegraut; `saveDisabled` nur, wenn ohne eine Sache gar nichts geht (die Akte ohne Datei, die Sammelbestätigung ohne Auswahl).
- Keine eigenen Fußleisten, kein eigenes `sticky bottom-0`, kein `SaveBar`/`StickyFooter`. Dialoge ohne Hauptaktion (nur Schließen, nur Abbrechen) behalten einen `DialogFooter`, mit Grund im Code.

Bausteine: `forms/form-action-bar.tsx`, `forms/save-status.tsx`, `forms/submit-button.tsx`, `forms/action-form.tsx`, `forms/use-autosave.ts`.

## C — Bearbeiten

| Art | Muster |
|---|---|
| **Stammdaten** (etwas, das man pflegt: Tiere, Projekte, Partner, Webseiten-Einträge) | Die Detailseite ist das Formular. Nebenlisten darunter. Anlegen auf einer eigenen Seite `/new` (oder `[id]` mit `id === 'new'`), nicht in einem Dialog. Letzter Abschnitt der Seite: `DangerSection` (Löschen oder Archivieren). |
| **Vorgang** (Ablauf, Freigabe, Festschreibung, Dokument der Akte) | Lesesicht. „Bearbeiten“ bzw. „Korrigieren“ als einziger Knopf im `PageHeader`. |

- Ein Dialog zum Anlegen nur als Schnellanlage aus einem anderen Vorgang heraus (etwa ein Kontakt aus der Auswahl heraus), mit denselben Feldern wie die Seite.
- Löschen und Archivieren nie in der Kopfzeile und nie neben „Speichern“. `DangerSection title text actionLabel onAction` ist eine Karte mit Titel, einem Satz und einem Outline-Knopf; der Knopf öffnet den Bestätigungsdialog der Seite. Gelöscht wird, wo der Bestand es erlaubt, über `DeleteRecordDialog` (Vorschau, in zwei Stufen: erst zurückziehen, dann löschen); wo etwas dranhängt (ein Partner mit Zahlungen), bleibt das Archivieren, also das Deaktivieren.
- Ein Lösch-, Storno- oder Widerrufsknopf auf der Seite ist neutral (`outline`, wie in `DangerSection`), auch wenn er gesperrt ist; Rot (`destructive`) gehört erst in den Bestätigungsdialog. Kein `border-error` und kein `text-error` an einem `Button` (Wächter `no-red-button-border.test.ts`).
- **Ausnahme Kontakte:** Sie sind noch Lesesicht mit Bearbeiten-Dialog und Anlegen im Dialog; die Umstellung auf das Stammdatenmuster ist vorgemerkt und steht bis dahin in der Erlaubnisliste von `stammdaten-new-route.test.ts`.

Bausteine: `forms/danger-section.tsx`, `forms/delete-record-dialog.tsx`, `forms/publish-switch.tsx`, `forms/reorder-buttons.tsx`, `page-header.tsx`.

## D — Einstellungen

- Unterbereiche über `components/panel-nav.tsx` (`?panel=`). Keine eigenen Reiter, keine gestapelten Bereiche. Ein Link von einer anderen Seite auf einen Bereich geht über `panelHref(basePath, panel)`; das `?panel=` selbst steht nur in diesem Baustein.
- Breite über `Page width="standard"` wie jede Formularseite (§ I); keine eigene Grenze im Panel.
- Pillen (`bg-brand-soft`) nur für Ansichten einer Liste, nie für Navigation.

Bausteine: `panel-nav.tsx` (mit dem Hilfsteil `panel-nav-scroll.tsx`, der den gewählten Reiter auf dem Telefon in den Blick schiebt).

## E — Formulare

- **Eine Karte** (`rounded-lg border border-line bg-surface`) mit Inhalt `p-5`; die `FormActionBar` ist das letzte Kind der Karte. Keine Karte in der Karte.
- Abschnitte mit `h3` 15/600, getrennt durch `border-t`, Abstand 20 (`mt-5 border-t border-line pt-5`), Inhalt eines Abschnitts `mt-3`.
- Raster je Abschnitt über `FormGrid`, Spannweite je Feld über `FormField size` (§ J). Kein `grid-cols-*` von Hand.
- Jedes Feld über `FormField` (Beschriftung, Pflichtmarke, Hinweis, Feldfehler).
- Reiter erst ab zwei Reitern; ein einzelner Reiter ist ein Abschnitt.

Bausteine: `forms/form-field.tsx`, `forms/form-grid.tsx`, `forms/localized-field.tsx`, `forms/media-picker.tsx`, `contact-picker.tsx`, `choice-cards.tsx`, `ui/radio-group.tsx` (zwei bis vier kurze Optionen, wo `ChoiceCards` zu schwer wäre; keine nativen Radios), `schema-form/`, `ui/input.tsx`, `ui/select.tsx`, `ui/textarea.tsx`, `ui/label.tsx`, `ui/tabs.tsx`.

## F — Marken

- Nur `StatusBadge` (Radius 4, 12/600), mit `tone` und höchstens einem Zeichen: `dot` für einen Zustand oder `icon` für eine Art. Symbol und Wort, nie nur Farbe.
- Pillen-Radius nur für Bedienelemente.

Bausteine: `status-badge.tsx`, `finance/entry-state-badge.tsx`.

## G — Listen

- `ui/table` (`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`) ohne eigene Kopf-, Zebra-, Hover- oder Höhenklassen; Aufrufstellen ergänzen nur Breiten und Ausrichtung. Zeilenhöhe und Zellpolster folgen der Dichte im Profil.
- **Öffnen:** Das Element in der ersten Inhaltsspalte trägt eine unsichtbare Fläche über die ganze Zeile — `RowLink` (navigiert; echter Link, Cmd-/Strg-Klick öffnet einen Tab) bzw. `RowButton` (klappt auf oder öffnet ein Seitenfenster; mit `aria-expanded` bzw. `aria-haspopup="dialog"`). **Kein `onClick`, `onKeyDown`, `tabIndex` oder `cursor-pointer` an einer Zeile.**
- Haken, Schalter, Knöpfe, Menüs und Links in anderen Zellen liegen über der Fläche und öffnen die Zeile nicht nebenbei (macht `TableCell` selbst). Eine Zelle mit Text zum Kopieren (IBAN, Belegnummer, Betrag) bekommt `selectable`.
- Sortierbare Spalten über `SortableHead`; Filter setzen nur Query-Parameter (`useUrlFilters`). Mehrfachauswahl über `SelectionBar` (unten klebend, mit Ansage für Vorleser).
- Leer: `EmptyState`; gefiltert leer: `EmptyState` mit „Keine Treffer“.

Bausteine: `ui/table.tsx`, `sortable-head.tsx`, `selection-bar.tsx`, `empty-state.tsx`, `ui/checkbox.tsx`, `ui/switch.tsx`.

## I — Breiten

- Jede Seite über `<Page width header={<PageHeader …/>}>`: `task` 720 (ein Vorgang in einer Spalte: Auslage, Umwidmung, Kasse), `standard` 1200 (Formulare, Details, Einstellungen, Übersichten, Listen bis vier Spalten), `full` (Listen ab fünf Spalten, Arbeitsflächen: Akte mit Ordnerspalte, Arbeitskorb, Mediathek, Startseite).
- Die Breite gilt für Kopf und Inhalt zusammen, linksbündig. `ForbiddenCard` und `EmptyState` stehen ebenfalls in `Page`.
- Die Seite wählt, nicht der Bereich: kein `max-w-[…]` in Seiten und Panels. Fließtext `max-w-prose`; schmale Felder über das Raster (§ J).
- Dialoge über `DialogContent size` (Pflicht): `sm` 440 (bestätigen, ein bis zwei Felder), `md` 560 (innen ~512 px, zwei Spalten), `lg` 760 (zwei Spalten, Auswahl mit Liste, Protokoll), `xl` 1040 (mit Vorschau). Faustregel: bis etwa sechs Felder `md`, mehr Felder `lg`. Telefon: `sm`/`md` als Blatt von unten, `lg`/`xl` als Vollbild; `mobile` übersteuert das. Kein `sm:max-w-[…]`, kein `w-[…]`, kein eigenes Polster oder `--dialog-pad`; randloser Inhalt über `layout="fixed-footer"`.
- Seitenfenster über `SheetContent size`: `sm` 400 (Hilfe, Navigation), `md` 560 (Detail, Ordner); auf dem Telefon volle Breite. Polster 20 px wie im Dialog, im inneren Behälter (`<div className="p-5">`), nicht am `SheetContent`. Ausnahme: Navigation und Ordnerblatt — Listen ohne Rand mit eigenen Zeilenrändern.

Begründung 1200: Die Schale nimmt 344 px; Inhalt bei Vollbild Air 13″ 1126, Pro 14″ 1168, Air 15″ 1366, Pro 16″ 1384 px. Auf kleinen Schirmen greift die Grenze kaum, ab 15″ hält sie Kopf, Felder und Speicherleiste zusammen.

Bausteine: `page.tsx`, `ui/dialog.tsx`, `ui/sheet.tsx`. Wächter: `page-width.test.ts`, `no-fixed-max-width.test.ts`, `dialog-size.test.ts`.

## J — Formularraster

- Ein `FormGrid` je Abschnitt. Spalten nach Kartenbreite (`@container`), nicht nach Fenster: ab 880 px vier, ab 420 zwei, darunter eine — eine Spalte ist so nie schmaler als rund 200 px. Dasselbe Formular steht so in Seite, Dialog `lg` und Telefon richtig.
- `FormField size`:

| size | Spalten bei 4 · 2 · 1 | wofür |
|---|---|---|
| `s` | 1 · 1 · 1 | kurze Werte bis ~20 Zeichen: PLZ, Land, Jahr, Datum, Betrag, Anrede, Nummern, Telefon |
| `m` (Standard) | 2 · 1 · 1 | Namen, E-Mail, Webadresse, Auswahlfelder, IBAN |
| `l` | 3 · 2 · 1 | Langtext (hält Zeilen unter ~100 Zeichen) |
| `full` | 4 · 2 · 1 | Fotos, Zeilen-Editoren, Editor mit Vorschau daneben |

- Zeilen müssen nicht voll sein; nichts wird gestreckt. Zusammengehöriges steht in der Quelle hintereinander und bildet so eine Zeile (Straße `m` · PLZ `s` · Ort `s`). Neue Zeile erzwingen: `<FormRowBreak />`, sparsam.
- Was im Raster kein Feld ist (Bildwähler, Zeilen-Editor, Hinweis, Vorschau, Auswahlgruppe): `FormCell size` mit denselben Größen, Standard `m`; `as` behält das Element (`p`, `fieldset`, `dl`, `RadioGroup`). Die Klassen der Spannweite schreibt niemand von Hand — `FIELD_SPAN` ist nicht exportiert.
- Schalter und Haken im Raster: `FormField toggle` — Label neben dem Bedienelement, unten bündig mit den Feldern der Zeile. Kein `pt-6`-Ausgleich.
- Mehrsprachige Felder: `size` gilt je Sprache; nebeneinander stehende Sprachen multiplizieren die Spannweite (zwei Sprachen: `s` → `m`, `m` → `full`). Ist eine Sprache schon `full`, stehen die Sprachen immer untereinander, jede über die volle Breite.
- Sprachkürzel: Bei einzeiligen Feldern steht es links **im** Feld als Präfix (Aufbau wie das „€“ im Betragsfeld, Stil der Marke mono 11/600, feste Mindestbreite, damit die Texte bündig beginnen — auch bei `pt-br`); so liegen alle Eingaben einer Rasterzeile auf einer Linie. Mehrzeilige Felder (Textarea, Markdown) tragen es über dem Feld. Das Label steht einmal oben für alle Sprachen; jede Eingabe heißt zugänglich „‹Label› (‹Sprachname›)“ (Sprachname über `Intl.DisplayNames`). „Nicht übersetzt“ steht unter dem Feld. Bausteine: `LocaleInput`, `LocaleLabel` in `forms/localized-field.tsx`, genutzt von `LocalizedField` und `schema-form`.
- `schema-form`: Größe aus `field.size` im Template-Schema, sonst nach Typ (`text`/`select`/`reference` `m`, `number`/`date` `s`, `textarea`/`markdown` `l`, `asset`/`list`/`objectList` `full`, `localized` wie sein innerer Typ). Ein `references`-Feld hat keinen eigenen Block: Seine Plätze stehen als einzelne Zellen im Raster des Abschnitts, `size` gilt je Platz (Standard `m`); der erste Platz trägt den Feldnamen, die weiteren „Platz n“, zugänglich heißt jeder „‹Feldname›, Platz n“. `field.group` bildet aus aufeinanderfolgenden Feldern einen Abschnitt mit Titel.
- Vorlage: Einstellungen → Verein (Name · Anschrift · Land und Zeit · Register · Kontakt).

Bausteine: `forms/form-grid.tsx` (`FormGrid`, `FormCell`, `FormRowBreak`), `forms/form-field.tsx`. Wächter: `form-grid.test.ts`.

## Seitenrahmen

- `Page` mit `PageHeader` auf jeder Seite (§ I); `back` für Seiten, die nicht in der Navigation hängen (alles mit Platzhalter oder mit den Endungen `new`, `edit`, `receive` im Pfad) — `tests/back-navigation.test.ts` prüft es.
- Die Kopfzeile hat höchstens eine primäre Aktion, und zwar die naheliegende Hauptaktion der Seite (Anlegen auf einer Liste, „Bearbeiten“ auf einer Lesesicht, der Export auf der Protokollseite); alle anderen Knöpfe dort sind `outline`. Sie bleibt primär, auch wenn sie gesperrt ist.
- Fehlendes Recht → `ForbiddenCard`; Schritt nicht erlaubt → `BlockedState`; Modul aus → `ModuleInactiveCard`.
- Anlegen- und Hinzufügen-Knöpfe tragen kein „+“, weder als Symbol noch im Text („Kontakt anlegen“, „Sprache auswählen…“); auch der Knopf „Neuer Ordner“ der Ordnerbäume. Wächter `no-plus-on-create.test.ts`, Ausnahmen dort mit Grund.
- Nur Tokens aus dem Theme; keine statischen Farben, keine shadcn-Klassennamen (`bg-primary`, `bg-muted`, `text-destructive`).
- **Telefon (unter 640 px, `max-sm`):** Die Kopfzeile zeigt keinen Vereinsnamen und keine vorderen Brotkrumen — nur den Seitentitel —, die Suche als Lupe ohne Text und Tastenkürzel, das Nutzermenü nur mit Initialen. `PageHeader` stellt Titel und Aktionen untereinander, die Aktionen brechen um (Joe 2026-10-06).

Bausteine: `page-header.tsx`, `forbidden-card.tsx`, `blocked-state.tsx`, `module-inactive-card.tsx`, `empty-state.tsx`.

## Fachbausteine und Grundbausteine

Was keinem der Abschnitte oben gehört, steht im Wächter `component-inventory.test.ts` mit seiner Zuordnung: Bausteine der Hülle (`shell/`), der Ordnerbäume (`folder-tree/`), der Mediathek (`media/`), der Webseite (`site/`), der Finanzen (`finance/`) und die Grundbausteine unter `ui/`. Eine neue Datei unter `src/components/` macht diesen Test rot: Sie wird dort eingeordnet, mit der Freigabe, die sie nennt.

## Vor dem Commit

- [ ] Art bestimmt (Stammdaten oder Vorgang), Muster C eingehalten
- [ ] Speichern über `FormActionBar`; keine eigene Leiste
- [ ] Ablehnungen über `state` an Leiste, Dialog oder `RefusalNotice`; kein `toast.error`
- [ ] Listen über `ui/table`, Öffnen über `RowLink`/`RowButton` in der ersten Inhaltsspalte
- [ ] Einstellungen mit Unterbereichen über `PanelNav`
- [ ] Seite über `Page width`, Dialog über `DialogContent size` (§ I)
- [ ] Formular als eine Karte, Abschnitte statt Reiter, Raster über `FormGrid`, jedes Feld über `FormField size` (§ J)
- [ ] Löschen oder Archivieren als `DangerSection` am Ende der Detailseite
- [ ] `apps/kompass/tests/patterns/` grün
