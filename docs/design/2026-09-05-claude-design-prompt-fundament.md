# Aluna Kompass — Design-Briefing für Claude Design (Stufe 1 „Fundament")

## Was du gestaltest

Die Admin-Oberfläche von **Aluna Kompass**, einem Vereinsverwaltungstool für gemeinnützige Vereine. Es läuft als Web-App im lokalen Netz eines Vereins auf einem NAS und wird von wenigen Vorstandsmitgliedern am Laptop bedient. Es ist kein Marketing-Produkt und keine öffentliche Webseite, sondern ein ruhiges, dichtes Arbeitswerkzeug für Verwaltung, Buchhaltung und Rechenschaft. Später erfasst es alle Vereinsvorgänge (Finanzen, Mitglieder, Tiere, Webseite); in dieser Runde gestalten wir nur das Fundament: Shell, Login, Administration.

Das Tool ist **generisch** und Open Source. Jeder Verein bringt eigene Farben, Logo und Schriften als Daten mit. Deshalb gestaltest du mit einem **neutralen Default-Theme**, nicht mit den Farben eines bestimmten Vereins.

## Designrichtung

- Schlank, modern, ruhig. Vorbild: gut gemachte Admin-Oberflächen mit shadcn/ui-Vokabular (Tabellen, Formulare, Dialoge, Badges, Toasts), nicht Dashboard-Kitsch.
- Desktop-first (1280 px und 1440 px), muss aber bis Tablet-Breite (1024 px) sauber funktionieren. Kein Mobile-Layout nötig.
- Datendichte für Verwaltungsarbeit: Tabellen mit klarer Zeilenhöhe, Formulare in zwei Spalten, wo sinnvoll, keine großen Hero-Flächen.
- Typografie: eine humanistische Sans für Fließtext und UI, optional eine dezente Serif für Überschriften. Nur freie Schriften (Google Fonts oder ähnlich), keine Office-Schriften.
- Hell und Dunkel gleichwertig. Beide Varianten vollständig ausgestalten.
- Barrierefreiheit: Kontrast mindestens WCAG AA, sichtbare Fokus-Zustände, Tastaturbedienbarkeit mitdenken.
- Sprache der Oberfläche: **Deutsch**. Bezeichner im Code (Token-Namen, Komponenten) bleiben Englisch.

## Harte Regel: Themes und Tokens

Es gibt im Code keinen einzigen statischen Farbwert. Jede Farbe, Schrift und Rundung ist ein Token. Ein Theme liefert für jedes Token einen Wert für `light` und `dark`. Bitte arbeite ausschließlich mit diesem Token-Schema und weise jedem Token im Default-Theme einen Wert zu:

Farben:
`--color-primary`, `--color-primary-ink`, `--color-primary-soft`, `--color-accent`, `--color-accent-deep`, `--color-accent-soft`, `--color-success`, `--color-success-bg`, `--color-warning`, `--color-warning-bg`, `--color-error`, `--color-error-bg`, `--color-info`, `--color-info-bg`, `--bg`, `--surface`, `--surface-2`, `--sidebar-bg`, `--topbar-bg`, `--ink`, `--ink-2`, `--muted`, `--muted-2`, `--on-primary`, `--on-primary-muted`, `--line`, `--line-2`, `--line-strong`

Typografie und Form:
`--font-body`, `--font-heading`, `--radius-sm`, `--radius-md`, `--radius-lg`

Wenn dir beim Gestalten ein Token fehlt (zum Beispiel für Hover-Zustände, Fokus-Ringe, Tabellen-Zebrastreifen, Overlay-Hintergründe), **schlage es explizit vor** und benenne es im gleichen Muster. Ich will die Lücken des Schemas finden, nicht überspielen.

Eine einzige Ausnahme: Der **Umgebungsbalken** (siehe unten) hat feste Signalfarben, die kein Theme überschreiben darf.

## Informationsarchitektur der Shell

- **Sidebar links**, einklappbar. Oben: Logo-Platzhalter und Vereinsname. Navigationsgruppen entstehen später aus Modulen; in dieser Runde zeige bitte die Gruppe **„Verwaltung"** mit den Einträgen Nutzer, Rollen, Einstellungen, Themes, Module, Änderungsprotokoll, Dokumente, Backup, sowie **eine beispielhafte, deaktivierte Modulgruppe** (etwa „Finanzen", ausgegraut mit Hinweis „Modul nicht aktiv"), damit das Muster für spätere Module sichtbar ist. Unten: Nutzername mit Menü (Profil, Hell/Dunkel, Abmelden).
- **Topbar**: Seitentitel, Breadcrumb, rechts Suche-Platzhalter und Nutzer-Avatar.
- **Umgebungsbalken**: In den Umgebungen Dev und Test liegt über der gesamten App ein schmaler, unübersehbarer Balken mit dem Text „TESTUMGEBUNG" beziehungsweise „ENTWICKLUNG". Er ist bewusst hässlich-deutlich und theme-unabhängig. In Produktion fehlt er. Zeige beide Zustände.

## Screens (ein Artboard je Screen, jeweils in Hell; die Shell zusätzlich in Dunkel)

1. **Erste Einrichtung**: Leerer Zustand beim allerersten Start. Ein Formular, das genau einmal den ersten Admin anlegt (Name, E-Mail, Passwort, Vereinsname). Freundlich, aber ohne Onboarding-Zirkus.
2. **Login**: E-Mail und Passwort, Fehlerzustand bei falschen Daten. Kein Self-Signup, kein „Passwort vergessen"-Link.
3. **Shell mit Startseite**: Nach dem Login. Die Startseite ist in Stufe 1 fast leer: Begrüßung, drei Hinweiskarten („Einstellungen vervollständigen", „Rollen anlegen", „Module aktivieren") mit Fortschritt. Zeige diesen Screen in Hell **und** Dunkel sowie einmal mit Umgebungsbalken „TESTUMGEBUNG".
4. **Nutzer**: Tabelle (Name, E-Mail, Rollen als Badges, Status aktiv/inaktiv, letzte Anmeldung), Aktion „Nutzer anlegen" als Dialog. Deaktivieren statt Löschen: Es gibt nirgends im Tool einen Löschen-Knopf für protokollierte Daten.
5. **Rollen**: Liste der Rollen, daneben oder darunter die Bearbeitung einer Rolle mit einer **Rechte-Matrix**: Zeilen sind Permission-Keys gruppiert nach Modul (in Stufe 1 nur der Kern: `users.manage`, `roles.manage`, `settings.manage`, `modules.manage`, `audit.view`, `documents.create`, `documents.view`, `media.upload`, `backup.export`, `backup.import`), mit deutscher Beschriftung und Beschreibung, Checkboxen. Rollenname ist freier Text (zum Beispiel „Schatzmeisterin", „Kassenprüfer").
6. **Einstellungen**: Reiter „Verein" (Name, Rechtsform, Adresse, Vereinsregister, Kontakt), „Steuer & Bescheide" (Steuernummer, Finanzamt, Art und Datum des Freistellungsbescheids, Satzungszweck als Textfeld), „Bank" (IBAN, BIC, Bankname), „Branding" (Logo-Upload, Schriftwahl, aktives Theme). Formulare mit Validierungsfehlern zeigen, Speichern-Leiste unten.
7. **Theme-Editor**: Liste der Themes (Default und ein Beispiel „Vereinsfarben"), Bearbeitung eines Themes: alle Tokens des Schemas als Farbfelder mit Hell/Dunkel nebeneinander, rechts eine **Live-Vorschau** mit Sidebar-Ausschnitt, Buttons, Badges, Tabelle und Formularfeld, umschaltbar Hell/Dunkel. Aktionen: Duplizieren, Aktivieren. Kontrast-Warnung, wenn ein Paar unter AA fällt.
8. **Module**: Liste der installierten Module mit Beschreibung und Schalter aktiv/inaktiv, Hinweis, dass Daten beim Deaktivieren erhalten bleiben. Zeige den Kern als nicht abschaltbar.
9. **Änderungsprotokoll**: Filterbare Tabelle (Zeitpunkt, Nutzer, Kanal „Oberfläche"/„MCP", Aktion, Objekt, Zusammenfassung). Klick öffnet eine Seitenleiste mit Vorher/Nachher-Ansicht als Feld-Diff. Aktion „Als PDF exportieren".
10. **Dokumente**: Liste erzeugter PDFs (Vorlage, Bezug, erstellt von, Datum), Dialog „Dokument erzeugen" mit Vorlagenwahl und Formular (Beispiel: Briefbogen mit Freitext). Vorschau-Panel für das fertige PDF.
11. **Backup**: Export-Karte mit Zeitpunkt des letzten Exports und Download; Import-Karte mit Datei-Upload und einem Bestätigungsdialog, in dem der Nutzer den Umgebungsnamen eintippen muss („test"), bevor überschrieben wird. Warnzustand deutlich, aber im Theme-System.
12. **Profil**: Passwort ändern, Abschnitt **API-Tokens** für den MCP-Zugang: Liste (Name, erstellt, zuletzt genutzt), „Token erstellen" mit Anzeige des Klartext-Tokens **genau einmal** in einem Dialog mit Kopieren-Knopf, danach nur noch Widerrufen.

## Zusätzlich gewünscht

- **Token-Sheet**: Ein Artboard, das alle Tokens mit Werten für Hell und Dunkel zeigt, plus deine vorgeschlagenen Ergänzungen.
- **Komponenten-Sheet**: Buttons (primär, sekundär, destruktiv, ghost), Eingabefelder mit Fehler, Select, Checkbox, Switch, Badges (Status neutral, Erfolg, Warnung, Fehler, Info), Tabelle mit Sortierung und Zebrastreifen, leerer Zustand, Toast, Bestätigungsdialog, Seitenleiste.
- Kurze Anmerkungen pro Artboard, warum du etwas so entschieden hast, wo du vom Briefing abgewichen bist und was dir im Briefing gefehlt hat.

## Was du nicht tun sollst

- Keine Farben, Logos oder Namen eines echten Vereins. Vereinsname in den Mockups: „Musterverein e.V.".
- Keine Screens für Finanzen, Mitglieder, Tiere oder Webseite. Die kommen in späteren Runden.
- Keine Marketing-Elemente, keine Illustrationen, keine Hero-Bereiche.
- Keine Löschen-Aktionen für protokollierte Daten. Es gibt Deaktivieren, Widerrufen, Stornieren.
- Keine hartcodierten Farbwerte außerhalb des Token-Sheets.
