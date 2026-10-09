-- Protokoll in Sätzen (Spec 2026-10-09, Fassung 0.2.9): Das Protokoll speichert Werte (`params`) statt eines
-- fertigen Satzes (`summary`). Einmaliger Umbau vor dem ersten rechenschaftsrelevanten Bestand; alte Einträge
-- verlieren nur ihren gespeicherten Satz und behalten Zeit, Person, Kanal, Aktion, Datensatz und Vorher/Nachher.
ALTER TABLE `audit_log` ADD `params` text;--> statement-breakpoint
ALTER TABLE `audit_log` DROP COLUMN `summary`;