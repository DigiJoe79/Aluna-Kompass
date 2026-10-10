# Muster — wie Kompass-Seiten gebaut werden

Gilt für jede neue Seite und jedes neue Modul, für Menschen wie für Agenten: **Vor jeder neuen Seite oder jedem neuen Modul dieses Dokument lesen.** Die Oberfläche besteht aus den Bausteinen unter `apps/kompass/src/components/`; wer einen neuen Baustein oder eine neue Variante eines vorhandenen braucht (Leiste, Marke, Tabelle, Reiter, Meldung, Dialogfuß, Knopf), braucht dafür eine ausdrückliche Freigabe — siehe `AGENTS.md`, „Oberfläche nur aus bestehenden Bausteinen“.

Abweichungen von den Mustern stehen nur in der Erlaubnisliste des jeweiligen Wächter-Tests (`apps/kompass/tests/patterns/`), je Zeile mit Begründung. Das Diff zeigt sie, also sieht sie das Review. Herkunft: Fassung 0.2.6 (Konsistenz).

**Positivliste.** Die Wächter sagen, was erlaubt ist, nicht nur, was verboten ist: Schrift, Größe und Farbe eines Dialogtitels, einer Beschreibung oder eines Abschnitts kommen aus dem Baustein; die Aufrufstelle ergänzt höchstens Layout (`flex`, `gap-*`, `items-*`, `truncate`, `sr-only`, `text-pretty`). Was abweicht, steht mit Grund in der Erlaubnisliste von `no-title-override.test.ts`. Keine rohen Elemente unter `src/app` (`no-raw-elements`) — Datei-Felder `sr-only` hinter Knopf oder Ablagefläche; Statusfarbe als Fläche oder Rahmen nur in `Notice`, `StatusBadge` und `ui/*` (`no-status-surface`). Herkunft: K10 (Designer und Joe 2026-10-06, Charge 2 2026-10-08).

Vorlage zum Abschreiben: das Modul **Projekte** — Liste `apps/kompass/src/app/(shell)/projects/page.tsx`, Anlegen und Detail `projects/[id]/page.tsx` (die Kennung `new` legt an), Formular `projects/project-form.tsx`, Weitere Aktionen (Löschen) `projects/project-actions.tsx`. Für eine Einstellungsseite mit Unterbereichen: `admin/settings/` (Reiter in der Adresse).

## A — Meldungen

- **Feld ungültig** → `FormField error` am Feld und `FormErrorSummary` oben.
- **Der Dienst lehnt ab** → der `ActionState` (`status: 'error'` mit `message`, optional `title`, `detail` und ein bis drei `remedies`) geht an `FormActionBar state`, `ConfirmDialog` oder — für Knöpfe, Menüs und Listen — an `RefusalNotice` über dem Auslöser. Ein Dialog bleibt bei Ablehnung offen und nennt den Grund. **Kein `toast.error`.**
- **Knopf ohne Formular** (Menü, Schalter in einer Zeile, Aktion im Dialog): `useActionFeedback()` liefert `{ state, run, reset }`; `run(() => action())` hält die Ablehnung, `RefusalNotice` zeigt sie über der Liste oder dem Knopf.
- **Kein Platz über dem Auslöser** (Listen-Schalter, Reihenfolge-Pfeile, Kachelhäkchen, Ziehen und Ablegen): `toastRefusal(state)` aus `lib/feedback.ts` — der Toast bleibt, bis man ihn schließt. Das ist die Ausnahme; jede Stelle steht mit Begründung in der Erlaubnisliste von `no-refusal-toast.test.ts`.
- **Netz gescheitert** (die Server Action warf): `runAction` macht daraus `kind: 'network'`; `useActionFeedback` zeigt einen Toast ohne Zeitlimit mit „Erneut versuchen“ (`run(fn, { retry })`). Gerätefehler (Kopieren) und Netzfehler beim Herunterladen gehen ebenso in einen Toast mit Schließen-Knopf. Grenze: Eine `<form action>`-Maske (`useActionState`/`ActionForm`) fängt React nicht ab; dort geht ein Wurf an die Fehlergrenze.
- **Feldfehler, den die Maske nicht zeigen kann** → `withUnplacedFieldErrors(state, [Felder, die sie zeigt])` macht daraus eine Ablehnung über der Leiste, statt dass nichts erscheint.
- **Veralteter Stand** → der Konflikt-Satz („Der Eintrag wurde inzwischen geändert“) mit den Auswegen „Ihre Änderungen neben den neuen Stand legen“ und „Neuen Stand laden“ (`lib/conflict-remedies.ts`); die Leiste zeigt ihn selbst.
- **Warnung ohne Sperre** → `Notice level="warn"` an der betroffenen Stelle; Hinweis → `level="hint"`.
- **Rolle:** `Notice level="refuse"` ist `alert`, `warn` ist `status`, `hint` trägt keine Rolle: Ein Hinweis, der von Anfang an dasteht, wird beim Lesen erfasst. Erscheint ein Hinweis erst nach einer Handlung (das Ergebnis mit Details nach einem Import), sagt `toast.success` das Ergebnis kurz an, der Kasten trägt die Details ohne Rolle (Designer 2026-10-08). Die Rolle kommt aus dem Baustein, nie von der Aufrufstelle. **Info-Blau gibt es nicht** — Farbe nur für Zustände, die eine Handlung verlangen; ein Hinweis ist `hint`, einer mit Folge vor dem Handeln `warn`.
- **Erfolg** ohne eigene Stufe: ein Zustand, der bleibt → `StatusBadge tone="success"` mit Satz; ein Ereignis → `toast.success`; ein Ergebnis mit Details (Zähler, übersprungene Zeilen) → `Notice level="hint"` mit Titel, ohne Grün.
- **Beschreibung eines Dialogs** → `DialogDescription` bzw. `SheetDescription` mit `tone`: `body` (14 px, `ink-2`), wenn der Satz die Folge erklärt — Löschen, Überschreiben, Veröffentlichen, ein einmalig sichtbares Geheimnis; sonst `meta` (Standard, 13 px, `muted`). Muted ist Text, den man auslassen kann. Der Satz bleibt in der Description, damit ein Vorleser ihn als Beschreibung des Dialogs sagt. `ConfirmDialog` setzt `body` selbst und verlangt `description`. Kein `className` für die Schrift (K10, Designer und Joe 2026-10-07).
- Ablehnungen nennen den Grund und bis zu drei Auswege, nie das Wort „Fehler“. Jede Ablehnung steht an der Stelle, an der man gehandelt hat.

Bausteine: `forms/form-error-summary.tsx`, `forms/field-error.tsx`, `forms/refusal-notice.tsx`, `forms/use-action-feedback.ts`, `forms/confirm-dialog.tsx`, `lib/feedback.ts`, `notice.tsx`.

## B — Speichern

- Immer `FormActionBar`, als **letztes Kind** der Formularkarte bzw. des Dialogs. Sie gehört in das `<form>` und liest den Stand von dort.
- `mode`: `edit` (Standard; ohne Änderung sagt sie „Nichts geändert“), `create` (schickt immer ab, der Dienst nennt die Pflichtfelder), `run` (eine Aktion ausführen, ohne Zähler).
- `hideDiscard` nur auf **Prüfseiten** (vorbefüllte Maske, entschieden wird mit Annehmen/Ablehnen): kein „Verwerfen“ neben „Ablehnen“; „Abbrechen“ und neu öffnen setzt zurück (Designer 2026-10-10, Wächter `hide-discard.test.ts`). In gewöhnlichen Formularen bleibt „Verwerfen“.
- Ab 640 × 600 px klebt die Speicherleiste am unteren Rand der Formularkarte, darunter steht sie am Ende der Karte. Die Formularkarte ist FormCard mit overflow-clip, nie overflow-hidden. (Designer 2026-10-08: Die Variante `stickybar` in `globals.css` schaltet das Kleben; einen Schatten trägt die Leiste nur, solange sie klebt. Am Telefon: Statuszeile, „Speichern“ über die volle Breite, darunter „Verwerfen“ und „Abbrechen“ nebeneinander. Mit ungespeicherten Änderungen fragt sie beim Verlassen der Seite nach. Wächter `form-card.test.ts`.)
- `placement`: `page` auf einer Seite (siehe oben), `dialog` klebt nichts (gilt, sobald `cancel` gesetzt ist). Ein Dialog mit eigenem Rand setzt `--dialog-pad` selbst (`[--dialog-pad:0px]` bei `p-0`, `1.5rem` bei `p-6`); `layout="fixed-footer"` am Dialog hält Kopf und Leiste fest und lässt die Mitte (`DialogBody`) scrollen — nötig, sobald die Maske höher werden kann als ein Fenster.
- Ohne `<form>` (Dialog mit eigenem Zustand): `onSave` und `pending`; gezählt wird über `count`.
- Linke Zeile über Props: `note` (Freigeber, Protokoll, Pflichtfeld-Legende), `status` (Zwischenstand laufend gesicherter Masken), sonst zählt die Leiste selbst. `destructive` macht den Hauptknopf zum Löschknopf; `testId`/`saveTestId` sind Kennungen für Tests.
- Speichern ist nie ausgegraut; `saveDisabled` nur, wenn ohne eine Sache gar nichts geht (die Akte ohne Datei, die Sammelbestätigung ohne Auswahl).
- Keine eigenen Fußleisten, kein eigenes `sticky bottom-0`, kein `SaveBar`/`StickyFooter`. Dialoge ohne Hauptaktion (nur Schließen, nur Abbrechen) behalten einen `DialogFooter`, mit Grund im Code.

Bausteine: `forms/form-action-bar.tsx`, `forms/form-card.tsx`, `forms/save-status.tsx`, `forms/submit-button.tsx`, `forms/action-form.tsx`, `forms/use-autosave.ts`.

## C — Bearbeiten

| Art | Muster |
|---|---|
| **Stammdaten** (etwas, das man pflegt: Tiere, Projekte, Partner, Webseiten-Einträge) | Die Detailseite ist das Formular. Nebenlisten darunter. Anlegen auf einer eigenen Seite `/new` (oder `[id]` mit `id === 'new'`), nicht in einem Dialog. Seltene Aktionen am Datensatz (Löschen, Archivieren) im Menü ⋯ „Weitere Aktionen“ (`RecordActions`) im `PageHeader`. |
| **Vorgang** (Ablauf, Freigabe, Festschreibung, Dokument der Akte) | Lesesicht. „Bearbeiten“ bzw. „Korrigieren“ als sichtbarer Knopf im `PageHeader`; Stornieren, Zurücknehmen, Löschen daneben im Menü ⋯ (`RecordActions`). |

- Ein Dialog zum Anlegen nur als Schnellanlage aus einem anderen Vorgang heraus (etwa ein Kontakt aus der Auswahl heraus), mit denselben Feldern wie die Seite.

**Weitere Aktionen** (Spec Seitenkopf, Designer 2026-10-08). Das Menü ⋯ ist der Ort für seltene Aktionen am ganzen Datensatz, auf Stammdaten- und Vorgangsseiten:

- **Nächster Schritt im Ablauf** (Buchen, Freigeben, Festschreiben, Veröffentlichen, Bearbeiten, Korrigieren) → sichtbarer Knopf im Kopf, nicht im Menü.
- **Macht etwas rückgängig oder beendet den Vorgang** (Archivieren, Stornieren, Zurückziehen, Ersetzen, Löschen) → Eintrag im Menü; mit „…“, wenn ein Dialog folgt.
- Auch bei genau einer solchen Aktion das Menü — dieselbe Art Aktion steht auf jeder Seite am selben Ort. `RecordActions` steht als letztes Element in `PageHeader actions`.
- **Reihenfolge fest** über `kind`: umkehrbar (`reversible`: Archivieren, Wieder aktivieren) → rückgängig machend (`undoing`: Stornieren, Zurückziehen, Ersetzen) → Löschen (`delete`) zuletzt. Einträge sind nie rot; Rot (`destructive`) gehört erst in den Bestätigungsdialog.
- Kein sichtbarer Eintrag → kein Knopf. **Keine Sperre ohne Grund:** Ist eine Aktion fachlich unmöglich (Frist läuft, noch verwendet), bleibt der Eintrag sichtbar und der Dialog nennt den Grund (`ConfirmDialog refusal`: `Notice refuse` als Beschreibung, nur „Schließen“). Ausgeblendet wird nur, was dauerhaft unmöglich ist und dessen Grund sichtbar auf der Seite steht (Hauptkonto, aktives Theme).
- Nicht beim Anlegen (`create`), nicht gesperrt bei ungespeicherten Änderungen. Löschen und Archivieren nie in der Speicherleiste einer Seite.
- **Archiviert oder deaktiviert:** `PageHeader status` (nur eine `StatusBadge`, neben dem Titel), „Wieder aktivieren“ als sichtbarer Knopf im Kopf.
- **Zurücknehmen:** Lässt sich eine Aktion nicht zurücknehmen, fragt ein Bestätigungsdialog (Erklärung und Vorschau nur dort, `tone="body"`); gelöscht wird, wo der Bestand es erlaubt, über `DeleteRecordDialog` (Vorschau, in zwei Stufen: erst zurückziehen, dann löschen). Lässt sie sich zurücknehmen **und** steht der Gegenweg danach dauerhaft auf der Seite oder im Menü, läuft sie ohne Rückfrage mit `toastUndo` (8 s, „Rückgängig“ ruft die Gegenaktion beim Dienst, nur ein solcher Toast zugleich). Der Toast ist eine Abkürzung, nicht der einzige Weg zurück.
- **Ausnahme Zurückhalten** (Vorschläge, Freigabe Joe und Designer 2026-10-10): Im Wisch-Stapel und bei der Hauptaktion eines Hinweises wird die Entscheidung 5 s zurückgehalten und erst dann abgeschickt (`lib/held-decision.ts`); „Rückgängig“ heißt dort „nicht abschicken“, nicht die Gegenaktion. Grund: Die Quelle liest Entscheidungen zurück und soll nie eine zurückgenommene sehen; eine Gegenaktion gibt es für Annehmen nicht. Ein zweiter Wisch schickt den ersten sofort ab; wer die Seite schließt, lässt den Vorschlag offen.
- **Dialoge gesteuert:** je Aktion genau eine Dialoginstanz mit `open`; der Menüeintrag öffnet nur. `RecordActions triggerRef` geht als `finalFocus` an den Dialog (`ConfirmDialog`, `DeleteRecordDialog`, `DialogContent`), damit der Fokus nach dem Schließen auf ⋯ liegt. Vorlage: `projects/project-actions.tsx`; E2E `record-actions.spec.ts` je Aufrufer.
- **Dialog und Seitenfenster** haben keinen Seitenkopf: Dort steht die Aktion links im Fuß — `FormActionBar recordAction` (nur `placement="dialog"`, im Typ und vom Wächter `record-action-placement` erzwungen; eine Aktion als `ghost`-Knopf, ab zwei das Menü ⋯), ohne `FormActionBar` `RecordActions single="button"` links im `SheetFooter` bzw. in der Fußzeile.
- Aktionen an Unterpositionen (Nachweis, Notiz, Verknüpfung, Beleg) und Zeilenaktionen in Listen sind nicht `RecordActions`.
- Ein Lösch-, Storno- oder Widerrufsknopf, der doch auf der Seite steht (in einer Zeile, einem aufgeklappten Detail), ist neutral (`outline`), auch wenn er gesperrt ist. Kein `border-error` und kein `text-error` an einem `Button` (Wächter `no-red-button-border.test.ts`). Jeder Dialog mit unumkehrbarer Hauptaktion hat eine `DialogDescription` (Wächter `destructive-dialog-description.test.ts`).
- **Ausnahme Kontakte:** Sie sind noch Lesesicht mit Bearbeiten-Dialog und Anlegen im Dialog; die Umstellung auf das Stammdatenmuster ist vorgemerkt und steht bis dahin in der Erlaubnisliste von `stammdaten-new-route.test.ts`.

Bausteine: `record-actions.tsx`, `forms/confirm-dialog.tsx` (`refusal`, `finalFocus`), `forms/delete-record-dialog.tsx`, `forms/form-action-bar.tsx` (`recordAction`), `lib/feedback.ts` (`toastUndo`), `forms/publish-switch.tsx`, `forms/reorder-buttons.tsx`, `page-header.tsx` (`status`).

## D — Einstellungen

- Unterbereiche über `components/panel-nav.tsx` (`?panel=`). Keine eigenen Reiter, keine gestapelten Bereiche. Ein Link von einer anderen Seite auf einen Bereich geht über `panelHref(basePath, panel)`; das `?panel=` selbst steht nur in diesem Baustein.
- Breite über `Page width="standard"` wie jede Formularseite (§ I); keine eigene Grenze im Panel.
- Pillen (`bg-brand-soft`) nur für Ansichten einer Liste, nie für Navigation.

Bausteine: `panel-nav.tsx` (mit dem Hilfsteil `panel-nav-scroll.tsx`, der den gewählten Reiter auf dem Telefon in den Blick schiebt).

## E — Formulare

- **Eine Karte**: `FormCard` (`rounded-lg border border-line bg-surface`, `overflow-clip`; `as` für `section` oder `form`) mit Inhalt `p-5` (`FormCardBody`); die `FormActionBar` ist das letzte Kind der Karte. Keine Karte in der Karte, kein `overflow-hidden` an der Karte oder einem Behälter darin (Reiter).
- Abschnitte über `Section title intro actions` (`components/section.tsx`): Titel in der Rolle `text-section` (15/600), Einleitung `text-meta`, Inhalt `mt-3`, Aktionen rechts neben dem Titel (brechen am Telefon um). Ein Folgeabschnitt bekommt Linie und Abstand selbst (`border-t`, 20 px) — aber nur, wenn er **direkt** auf eine `Section` folgt; ein Hinweis oder bedingter Wrapper dazwischen unterbricht die Linie (gewollt).
- Die Überschriftenebene kommt aus dem Umfeld: `Page` setzt 2 (der Seitentitel im `PageHeader` ist das einzige `h1`), `DialogContent`/`SheetContent` 3, eine verschachtelte `Section` eins mehr, höchstens 4, ohne Umfeld 2; `level` nur als Ausnahme. Einstellungs-Panels unter `PanelNav` haben keinen eigenen Titel, ihre Abschnitte stehen wie überall unter dem Seitentitel auf Ebene 2. Vorlagen: Projekt-Formular und Einstellungen → Verein; die übrigen handgeschriebenen Abschnitte folgen in K10 Charge 3.
- Raster je Abschnitt über `FormGrid`, Spannweite je Feld über `FormField size` (§ J). Kein `grid-cols-*` von Hand.
- Jedes Feld über `FormField` (Beschriftung, Pflichtmarke, Hinweis, Feldfehler).
- Reiter erst ab zwei Reitern; ein einzelner Reiter ist ein Abschnitt.

Bausteine: `forms/form-card.tsx`, `section.tsx`, `forms/form-field.tsx`, `forms/form-grid.tsx`, `forms/localized-field.tsx`, `forms/media-picker.tsx`, `contact-picker.tsx`, `choice-cards.tsx`, `ui/radio-group.tsx` (zwei bis vier kurze Optionen, wo `ChoiceCards` zu schwer wäre; keine nativen Radios), `ui/segmented.tsx` (zwei bis vier kurze, gleichrangige Optionen nebeneinander: `Segmented`, Radio-Semantik, Höhe wie ein Feld; ab fünf Optionen oder bei langen Beschriftungen `Select`; Symbole nur mit `ariaLabel` je Option), `forms/choice-compare.tsx` (Wahlzeile „Heute“/„Vorschlag“ einer Gegenüberstellung: zwei Flächen einer Radiogruppe, man wählt eine Seite; Freigabe Designer 2026-10-10, Board Vorschläge Artboard 2), `schema-form/`, `ui/input.tsx`, `ui/select.tsx`, `ui/textarea.tsx`, `ui/label.tsx`, `ui/tabs.tsx`.

## F — Marken

- Nur `StatusBadge` (Radius 4, 12/600), mit `tone` und höchstens einem Zeichen: `dot` für einen Zustand oder `icon` für eine Art. Symbol und Wort, nie nur Farbe.
- Pillen-Radius nur für Bedienelemente.

Bausteine: `status-badge.tsx`, `finance/entry-state-badge.tsx`.

## G — Listen

- `ui/table` (`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`) ohne eigene Kopf-, Zebra-, Hover- oder Höhenklassen; Aufrufstellen ergänzen nur Breiten und Ausrichtung. Zeilenhöhe und Zellpolster folgen der Dichte im Profil.
- **Öffnen:** Das Element in der ersten Inhaltsspalte trägt eine unsichtbare Fläche über die ganze Zeile — `RowLink` (navigiert; echter Link, Cmd-/Strg-Klick öffnet einen Tab) bzw. `RowButton` (klappt auf oder öffnet ein Seitenfenster; mit `aria-expanded` bzw. `aria-haspopup="dialog"`). **Kein `onClick`, `onKeyDown`, `tabIndex` oder `cursor-pointer` an einer Zeile.**
- Haken, Schalter, Knöpfe, Menüs und Links in anderen Zellen liegen über der Fläche und öffnen die Zeile nicht nebenbei (macht `TableCell` selbst). Eine Zelle mit Text zum Kopieren (IBAN, Belegnummer, Betrag) bekommt `selectable`.
- Gruppenzeilen über `TableGroupRow colSpan` (ein Kopf über alle Spalten der Gruppe).
- Sortierbare Spalten über `SortableHead`; Filter setzen nur Query-Parameter (`useUrlFilters`). Mehrfachauswahl über `SelectionBar` (unten klebend, mit Ansage für Vorleser).
- Leer: `EmptyState`; gefiltert leer: `EmptyState filtered` mit „Filter zurücksetzen“ (§ L). Eine Tabelle, deren Kopf stehen bleibt, zeigt die Leere als `TableEmpty colSpan` — eine Zeile im Ton von `EmptyState`, nie eine handgeschriebene Zelle.

Bausteine: `ui/table.tsx`, `sortable-head.tsx`, `selection-bar.tsx`, `empty-state.tsx`, `ui/checkbox.tsx`, `ui/switch.tsx`.

## I — Breiten

- Jede Seite über `<Page width header={<PageHeader …/>}>`: `task` 720 (ein Vorgang in einer Spalte: Auslage, Umwidmung, Kasse), `standard` 1200 (Formulare, Details, Einstellungen, Übersichten, Listen bis vier Spalten), `full` (Listen ab fünf Spalten, Arbeitsflächen: Akte mit Ordnerspalte, Arbeitskorb, Mediathek, Startseite).
- Die Breite gilt für Kopf und Inhalt zusammen, linksbündig. `ForbiddenCard` und `EmptyState` stehen ebenfalls in `Page`.
- Die Seite wählt, nicht der Bereich: kein `max-w-[…]` in Seiten und Panels. Fließtext `max-w-prose`; schmale Felder über das Raster (§ J).
- Dialoge über `DialogContent size` (Pflicht): `sm` 440 (bestätigen, ein bis zwei Felder), `md` 560 (innen ~512 px, zwei Spalten), `lg` 760 (zwei Spalten, Auswahl mit Liste, Protokoll), `xl` 1040 (mit Vorschau). Faustregel: bis etwa sechs Felder `md`, mehr Felder `lg`. Telefon: `sm`/`md` als Blatt von unten, `lg`/`xl` als Vollbild; `mobile` übersteuert das. Kein `sm:max-w-[…]`, kein `w-[…]`, kein eigenes Polster oder `--dialog-pad`; randloser Inhalt über `layout="fixed-footer"`.
- Seitenfenster über `SheetContent size`: `sm` 400 (Hilfe, Navigation), `md` 560 (Detail, Ordner); auf dem Telefon volle Breite. Polster 20 px wie im Dialog, im inneren Behälter (`<div className="p-5">`), nicht am `SheetContent`. Ausnahme: Navigation und Ordnerblatt — Listen ohne Rand mit eigenen Zeilenrändern.
- Titel über `DialogTitle`/`SheetTitle` ohne Klassen (Standard `font-heading text-dialog-title`, 19/600), Beschreibung mit `tone` (§ A). Kopf und Fuß eines Seitenfensters (`SheetHeader`, `SheetFooter`) haben 20 px Polster wie der Dialog; das Schließen-Kreuz hat in beiden 44 px Klickfläche.

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

## L — Filterleisten

Jede Liste mit Suche oder Filtern nutzt `FilterBar`. Reiter darüber sind `ViewTabs`. Der Zustand steht in der Adresse (`useUrlFilters`), auch bei kleinen Listen; nur Auswahldialoge (Medienwahl) halten ihn auf der Seite. Die Zählzeile zählt Treffer. „Filter zurücksetzen“ erscheint, sobald ein Filter gesetzt ist, und steht als Aktion im leeren Ergebnis. Begrenzte Listen blättern oder nennen die Grenze. Nicht in `FilterBar`: Kombobox-Felder (`ContactPicker`, `DocumentPicker`, Serienlauf „Ausschließen“), Befehlspalette, „Beleg suchen“ — sie wählen einen Wert und filtern keine Liste, übernehmen aber Lupe und ✕ vom `SearchField`. Herkunft: Board § L, HANDOFF § 8e, Spec Filterleisten 2026-10-08.

- **Feste Plätze:** Suche, bis zu drei Filter, „Weitere Filter (n)“, rechts Zählzeile und „Filter zurücksetzen“, dann `sort`, ganz rechts `view` (`Segmented` Liste/Raster). Die Leiste steht zwischen den Reitern und der Tabelle, außerhalb der Karte.
- **Suche:** `SearchField` — Lupe, ✕ „Suche leeren“, 260 px (Telefon volle Breite), Name „Suchen“, der Platzhalter nennt die Felder; gilt nach 250 ms, kein Knopf „Filtern“, kein Enter nötig.
- **Zählzeile:** ohne Filter „{total} {Nomen}“, mit Filter „{shown} von {total} {Nomen}“ (Nomen mit Dativ: „3 von 6 Hunden“); zählt Treffer, nicht die Zeilen einer Seite; `aria-live="polite"`. Was einen Bestand nur abgrenzt (das Jahr im Spendenbuch und in der Personenübersicht, eine Sicht wie „Prüfung offen“), ist das „von …“, kein gesetzter Filter. Ein solcher Rahmen ist ein Select ohne „alle“ über `frameFilter`: nie Rahmen in Primärfarbe, kein Chip, kein Zurücksetzen (Designer 2026-10-08); im Journal ist „Jahr: alle“ ein echter Filter.
- **Filter-Selects:** über `selectFilter` — Standardoption „{Filter}: alle“; ein gesetzter Filter ist am Text erkennbar („Sucht ein Zuhause“), der Rahmen in Primärfarbe kommt nur hinzu; der Fokusring steht mit Abstand neben dem Rahmen (`filterControlClass`). Ja/Nein-Filter als Checkbox „Nur …“ bzw. „Auch …“ (`checkFilter`), kein Switch.
- **Sortierung** außerhalb des Tabellenkopfs steht im Platz `sort` und ist kein Filter: Sie belegt keinen Filterplatz, zählt nicht als gesetzt und löst kein „Filter zurücksetzen“ aus. Im Tabellenkopf bleibt `SortableHead`.
- **Mehr als drei Filter:** die drei häufigsten in der Leiste, der Rest unter „Weitere Filter (n)“. Chips je gesetztem Filter erscheinen, wenn es `more` gibt oder ein versteckter Filter (`hidden`: `ids`, „anonym“) gesetzt ist; die Zählzeile rückt dann in die Chip-Zeile. Ein Chip lautet immer „{Filter}: {Wert}“ („Zustand: festgeschrieben“, „Konto: Girokonto“, „Suche: Futter“); nur Ja/Nein-Filter zeigen ihren Text allein („Nur ohne Beleg“). Das setzt `FilterBar` aus `label` und `chip` zusammen, nie die Seite; wiederholt eine Option den Filternamen, kürzt `chip` an der Option den Wert („Wiedervorlage: offen“) (Designer 2026-10-08).
- **Telefon (unter 640 px):** Suche über die volle Breite, alle Filter hinter „Filter (n)“ in einem Sheet von unten. Im Sheet wirken Filter erst mit „Anwenden“; Schließen verwirft den Entwurf; „Zurücksetzen“ wirkt sofort und schließt. Wer mehrere Werte in dieselbe Adresse schreibt, gibt `onApply` (ein Schreiben statt mehrerer, die sich überholen).
- **Gefiltert leer** ist ein eigener Zustand: `EmptyState filtered` — „{Nomen} passt zu diesen Filtern.“ mit „Filter zurücksetzen“; nie „Noch keine …“ und nie Anlegen.
- **Keine stille Grenze:** Kann der Dienst `offset` und `total`, blättert die Liste (`ListPager`, 50 je Seite, Filterwechsel → Seite 1); sonst nennt `ListTruncated` die Grenze mit der Gesamtzahl. Beide stehen als **Fuß in der Karte der Tabelle** (`footer`: Linie oben, Polster wie die Karte — wie die Speicherleiste der Fuß der Formularkarte ist); steht eine Liste ohne gemeinsame Karte (Mediathek, Personen-Gruppen), sitzen sie direkt darunter. Die Blätterknöpfe sind `outline sm`, eine Art im ganzen Bestand (Designer 2026-10-08). Eine Auswahl im Formular, die auf dem Rechner sucht (Ausgleich in der Buchungsmaske), und eine Beschriftung lesen alles über `readAllPages` (`lib/read-all-pages.ts`) statt der ersten 200.
- **Ordner sind Ort, keine Filter:** Ein Klick im Ordnerbaum behält Suche und Filter (Akte und Mediathek); die Zahl steht in der Zählzeile, nicht in der Ordnerüberschrift.
- **Reiter über Listen:** `ViewTabs` — Unterstrich, Links mit `aria-current="page"` (kein `role="tab"`), Zahl als `StatusBadge` (0 → keine), am Telefon waagerecht scrollend; die Zahlen zeigen, was ein Klick zeigen würde, und folgen den Filtern der Leiste, wo der Dienst es kann (Arbeitsliste: Konto; Hunde: alle Filter außer der Sicht selbst, „Sucht ein Zuhause“ → „Alle 3 · Prüfung offen 1“). Jahr ist ein Filter, kein Reiter.
- **Ausnahme Vorschläge** (Designer 2026-10-10, Board Vorschläge 1d): Der Reiter „Vorschläge“ der Tierliste führt auf eine andere Liste (`/animals/proposals`) mit eigenem Filter; die Filter der Tierliste reisen nicht mit, und seine Zahl zählt immer alle offenen Vorschläge, in `--color-agent` (`ViewTabs` `tone: 'agent'`).

Bausteine: `filter-bar.tsx` (`FilterBar`, `selectFilter`, `checkFilter`, `frameFilter`, `filterControlClass`), `search-field.tsx`, `view-tabs.tsx`, `list-pager.tsx`, `list-truncated.tsx`, `empty-state.tsx` (`filtered`), `lib/use-url-filters.ts`. Wächter: `filter-bar.test.ts`, `no-silent-limit.test.ts` (zählt auch Aufrufe von Diensten mit Standardgrenze im Schema oder Code — ohne `limit:` kürzt der Dienst sonst still —, gelesen aus den Quellen der Pakete).

## Schrift

Sechs Rollen in `app/globals.css` (`@theme`, `--text-*` mit Zeilenhöhe und Gewicht); `cn` kennt sie über `TYPE_ROLES` in `lib/utils.ts`. Die Schriftfamilie steht nie in der Rolle, sondern im Baustein bzw. an der Kennzahl.

| Klasse | Größe/Zeilenhöhe | Gewicht | Schrift steht … |
|---|---|---|---|
| `text-dialog-title` | 19/1.25 | 600 | `font-heading` im Standard von `DialogTitle`/`SheetTitle` |
| `text-section` | 15/1.35 | 600 | `font-heading` im Standard von `Section` |
| `text-body` | 14/1.5 | — | — |
| `text-meta` | 13/1.45 | — | — |
| `text-hint` | 12/1.4 | — | — |
| `text-figure` | 32/1 | — | `font-mono tabular-nums` an der Aufrufstelle (Kennzahl der Startseiten-Kachel) |

In K10 Charge 1 nutzen nur die Bausteine und die Kennzahl die Rollen; die übrigen `text-[…px]` folgen in Charge 3. Wächter: `no-title-override.test.ts`.

## Datum

Zwei Formate, drei Funktionen (K10, Joe 2026-10-07): Was ein Mensch am Bildschirm liest — in der Oberfläche oder als Meldung eines Dienstes —, folgt der Einstellung `ui.dateFormat` in der Zeitzone des Vereins; was auf Papier steht, ist fest `TT.MM.JJJJ`.

| Weg | Funktion | Format |
|---|---|---|
| Bildschirm | `formatDate(value, mode, timeZone, locale?)`, `formatDateTime(…, { seconds? })` (die Zeitzone ist Pflicht); im Client `useDateFormat()` (`date`, `dateTime`, `time`, `stamp`), auf dem Server `dateFormatOf(deps)` | Einstellung `ui.dateFormat` |
| Uhrzeit eines laufenden Vorgangs (Veröffentlichen) | `time(value)` / `formatTime(value, timeZone)` | fest `HH:mm`, 24 Stunden, Vereinszone |
| „gespeichert um …“ | `stamp(value)` / `formatStamp(value, mode, timeZone, now)` | am selben Vereinstag `HH:mm`, sonst Datum und Uhrzeit; nie relativ |
| Meldungen der Dienste (Ablehnungen, Hinweise) | `messageDate(deps, iso)` | `ui.dateFormat` (über `readSetting`), immer absolut |
| Papier (alles aus Typst, Betreffe der Akte) | `paperDate(iso)` | fest `TT.MM.JJJJ` |

Papier ist fest, weil ein Brief nach außen geht, die Zuwendungsbestätigung dem amtlichen Muster folgt und ein festgeschriebenes Dokument sich nicht ändern darf, wenn jemand später die Einstellung umstellt. Kein `toLocaleString`, kein `.slice(0, 10)` in einer Anzeige — Wächter `no-raw-date.test.ts`.

Sekunden (`dateTime(value, { seconds: true })`) nur im Protokoll — zum Abgleich mit Serverprotokollen und Backups; die Reihenfolge innerhalb einer Minute sichert die Sortierung, nicht die Anzeige. `time` hängt nicht an `ui.dateFormat`; wird die Oberfläche englisch, ist das neu zu entscheiden. Kein `useFormatter().dateTime` — Wächter `no-raw-date` Teil 4; Grenze: Ein Formatierer, der als Prop weitergereicht wird, ist für den Wächter unsichtbar.

## Seitenrahmen

- `Page` mit `PageHeader` auf jeder Seite (§ I); `back` für Seiten, die nicht in der Navigation hängen (alles mit Platzhalter oder mit den Endungen `new`, `edit`, `receive` im Pfad) — `tests/back-navigation.test.ts` prüft es.
- Die Brotkrume ist `nav` (`aria-label` „Brotkrume“) und endet bei der Liste; `aria-current="page"` trägt sie nur auf der Seite des letzten Segments, auf einer Detailseite ist es ein Link. Genau ein `h1` je Seite: der Titel im `PageHeader` — jede Seite hat einen. Wächter `one-h1.test.ts`; der E2E prüft Liste, Detail und Einstellungen, eine neue Seite ohne `PageHeader`-Titel fiele nur dort auf, wo sie getestet wird.
- Die Kopfzeile hat höchstens eine primäre Aktion, und zwar die naheliegende Hauptaktion der Seite (Anlegen auf einer Liste, „Bearbeiten“ auf einer Lesesicht, der Export auf der Protokollseite); alle anderen Knöpfe dort sind `outline`. Sie bleibt primär, auch wenn sie gesperrt ist.
- Fehlendes Recht → `ForbiddenCard`; Schritt nicht erlaubt → `BlockedState`; Modul aus → `ModuleInactiveCard`.
- Anlegen- und Hinzufügen-Knöpfe tragen kein „+“, weder als Symbol noch im Text („Kontakt anlegen“, „Sprache auswählen…“); auch der Knopf „Neuer Ordner“ der Ordnerbäume. Wächter `no-plus-on-create.test.ts`, Ausnahmen dort mit Grund.
- Nur Tokens aus dem Theme; keine statischen Farben, keine shadcn-Klassennamen (`bg-primary`, `bg-muted`, `text-destructive`).
- **Telefon (unter 640 px, `max-sm`):** Die Kopfzeile zeigt keinen Vereinsnamen und keine vorderen Brotkrumen — nur den Seitentitel —, die Suche als Lupe ohne Text und Tastenkürzel, das Nutzermenü nur mit Initialen. `PageHeader` stellt Titel und Aktionen untereinander, die Aktionen brechen um (Joe 2026-10-06).

Bausteine: `page-header.tsx`, `forbidden-card.tsx`, `blocked-state.tsx`, `module-inactive-card.tsx`, `empty-state.tsx`.

## Protokoll

Das Änderungsprotokoll speichert, was geschah — Aktion, Datensatz, Werte —, nie einen fertigen Satz (Spec Protokoll in Sätzen, 2026-10-09).

- **Katalog im Manifest:** `auditActions` nennt jede Aktion des Moduls mit ihren Werten (`{ params: ['number'] }`; Kern: `packages/core/src/audit/actions.ts`). `recordAudit` wirft bei einer Aktion ohne Katalog, einem fehlenden oder fremden Wert und einem Wert, der keine Zahl, kein Text, kein Schalter und nicht `null` ist. Die Aktion steht als fester Text im Aufruf (`action: 'dms.file'`), auch das letzte Argument von `writeSettingInternal`.
- **`params` sprachneutral:** Codes statt Wörter (`sentVia: 'post'`), Datum als ISO (Schlüssel auf `At` für Zeitpunkte, `On` für Tage — nur diese formatiert die Anzeige), Zahlen als Zahl, Schalter als `boolean`; Nutzdaten (Ordnerpfad, Name eines Hundes, Nummer) sind erlaubt, ein im Code gebauter Satz nie. Personen nur als ID unter `…UserId`/`…ContactId`, nie Name, E-Mail, Telefon, IBAN; die Finanzen nennen auch keine Kontakt-ID. Eine ID, die nur den Datensatz wiederholt, ist kein Wert — die Spalte „Objekt“ nennt ihn.
- **Zwei Texte je Aktion:** `audit.actions.<aktion>` (Klartext, Pflicht: Filter, Titel, Rückfall) und `audit.sentences.<aktion>` (Satz mit ICU-Platzhaltern, optional; Personen ohne `Id`: `{targetUser}`, `{contact}`). Punkte im Schlüssel werden zu Unterstrichen. Satzform wie der Klartext: Objekt vor Partizip, Werte in „…“ (Personen ohne), kein Punkt, kein Doppelpunkt und keine Klammer, Anzahlen über `plural` (Nullwerte mit `=0 {}` weglassen). Kein technischer Wert im Satz: Ein Code, der in der Oberfläche anders heißt (Schlüssel einer Einstellung, Sprachcode, Byte), bekommt in `DISPLAY` (`lib/audit-sentences.ts`) seine Beschriftung; ohne Beschriftung kein Satz.
- **Rückfall:** Ohne Satz, bei einem fehlenden Wert oder einer Person, die sich nicht mehr auflösen lässt, steht der Klartext — nie ein halber Satz (`lib/audit-sentences.ts`, für Tabelle, Detail und PDF).
- Wächter: `audit-actions.test.ts` (Katalog, Klartexte, feste Aktionen), `audit-sentences-catalog.test.ts` (Platzhalter eines Satzes stehen im Katalog), `patterns/no-audit-summary.test.ts` (kein `summary` neben `action`), `finance-wording.test.ts` (auch die Sätze der Finanzen).

## Fachbausteine und Grundbausteine

Was keinem der Abschnitte oben gehört, steht im Wächter `component-inventory.test.ts` mit seiner Zuordnung: Bausteine der Hülle (`shell/`), der Ordnerbäume (`folder-tree/`), der Mediathek (`media/`), der Webseite (`site/`), der Finanzen (`finance/`) und die Grundbausteine unter `ui/`. Eine neue Datei unter `src/components/` macht diesen Test rot: Sie wird dort eingeordnet, mit der Freigabe, die sie nennt.

## Vor dem Commit

- [ ] Art bestimmt (Stammdaten oder Vorgang), Muster C eingehalten
- [ ] Speichern über `FormActionBar`; keine eigene Leiste; Formularkarte über `FormCard` (overflow-clip, nie overflow-hidden)
- [ ] Ablehnungen über `state` an Leiste, Dialog oder `RefusalNotice`; kein `toast.error`
- [ ] Listen über `ui/table`, Öffnen über `RowLink`/`RowButton` in der ersten Inhaltsspalte
- [ ] Einstellungen mit Unterbereichen über `PanelNav`
- [ ] Seite über `Page width`, Dialog über `DialogContent size` (§ I)
- [ ] Formular als eine Karte, Abschnitte statt Reiter, Raster über `FormGrid`, jedes Feld über `FormField size` (§ J)
- [ ] Seltene Aktionen am Datensatz über `RecordActions` (im Dialog `recordAction`); Unumkehrbares mit Rückfrage
- [ ] Keine rohen Elemente, keine Statusfläche von Hand (`no-raw-elements`, `no-status-surface`)
- [ ] Keine Schrift, Größe oder Farbe an Titel, Beschreibung oder Abschnitt; Datum nur über `formatDate`, `messageDate` oder `paperDate`
- [ ] Liste mit Suche/Filtern über `FilterBar`; Grenze blättert oder wird genannt (§ L)
- [ ] `apps/kompass/tests/patterns/` grün
