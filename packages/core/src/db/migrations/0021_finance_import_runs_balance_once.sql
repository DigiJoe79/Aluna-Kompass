-- Von Hand angefügt (Plan „finanzen-n2-kleinkram“ Task 2): „Kontostand
-- nachtragen“ — ein CSV-Lauf ohne Kontostand bekommt ihn genau einmal
-- nachträglich (Spec 6.1 „sonst fragt der Lauf optional ‚Kontostand laut
-- Bank am …?‘“). `finance_import_runs_facts_immutable` (0018) sperrte
-- `opening_cents`/`closing_cents` zusammen mit den übrigen Abschlussfeldern,
-- sobald der Lauf fertig oder fehlgeschlagen war — dafür ersetzt, ohne die
-- zwei Saldo-Spalten.
DROP TRIGGER finance_import_runs_facts_immutable;
--> statement-breakpoint
CREATE TRIGGER finance_import_runs_facts_immutable BEFORE UPDATE OF period_from, period_to, count_new, count_known, count_held, count_pending_skipped, gap_from, gap_to, finished_at, failed_at, failure_code, failure_line ON finance_import_runs
WHEN OLD.finished_at IS NOT NULL OR OLD.failed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'an import run is a permanent record');
END;
--> statement-breakpoint
-- Ein Kontostand wird genau einmal gesetzt: entweder beim Import selbst
-- (`writeRun` schreibt opening_cents/closing_cents und finished_at in
-- derselben UPDATE-Anweisung — zu diesem Zeitpunkt ist OLD.finished_at noch
-- NULL, der Fall bleibt also erlaubt) oder danach genau einmal über
-- `setRunClosingBalance`, solange der Lauf fertig, nicht verworfen und ohne
-- Kontostand ist. Ein zweites Nachtragen (Tippfehler) und ein Nachtragen an
-- einem verworfenen Lauf sind gesperrt.
CREATE TRIGGER finance_import_runs_balance_once BEFORE UPDATE OF opening_cents, closing_cents ON finance_import_runs
WHEN OLD.finished_at IS NOT NULL AND (OLD.discarded_at IS NOT NULL OR OLD.closing_cents IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'a statement balance is set once');
END;
