-- Fassung 0.5.1, nur Daten (Backlog 63): die zwei Startarten der Akte heißen jetzt nach dem, was sie sind.
-- Nur unter dem deutschen Startnamen: Ab der ersten Sekunde gehören die Arten dem Verein, eigene Namen bleiben.
UPDATE document_types SET label = 'Eingang ohne Zuordnung' WHERE key = 'unclassified-in' AND label = 'Unklassifiziert (Eingang)';
--> statement-breakpoint
UPDATE document_types SET label = 'Ausgang ohne Zuordnung' WHERE key = 'unclassified-out' AND label = 'Unklassifiziert (Ausgang)';
