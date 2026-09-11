-- Volltextindex der Akte: eine Zeile je Seite.
--
-- Trigramm-Tokenizer, weil deutsche Komposita sonst unauffindbar bleiben —
-- "rechnung" findet "Tierarztrechnung" nur so. `remove_diacritics 1` faltet
-- Umlaute, damit "katzin" die "Kaetzin" trifft. Der Preis: Suchbegriffe unter
-- drei Zeichen finden nichts, und der Index wiegt rund das Dreifache des Texts.
--
-- Der Text liegt IN der Tabelle, nicht bloss sein Index: `snippet()` braucht
-- ihn, um die Fundstelle zu bauen.
--
-- Abgeleitet im Sinne von Prinzip 5: jederzeit aus den PDFs neu baubar, nie
-- Quelle von irgendetwas.
CREATE VIRTUAL TABLE `document_text` USING fts5(
  document_id UNINDEXED,
  page UNINDEXED,
  text,
  tokenize = 'trigram remove_diacritics 1'
);
