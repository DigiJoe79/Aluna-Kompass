-- Zähler aus dem Bestand: je Präfix und Jahr die höchste vergebene Nummer.
-- Für Dokumente, die vor dieser Migration gelöscht wurden, lässt sich nichts
-- nachholen; ab hier wird keine Nummer mehr wiedervergeben.
INSERT OR REPLACE INTO `document_counters` (`prefix`, `year`, `last`)
SELECT substr(`number`, 1, 3), CAST(substr(`number`, 5, 4) AS INTEGER), MAX(CAST(substr(`number`, 10) AS INTEGER))
FROM `documents`
WHERE `number` IS NOT NULL
GROUP BY substr(`number`, 1, 3), substr(`number`, 5, 4);
