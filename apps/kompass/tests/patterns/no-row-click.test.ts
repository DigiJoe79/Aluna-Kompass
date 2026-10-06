import { describe, expect, it } from 'vitest';
import { openingTags, read, relative, sourceFiles } from './source';

/**
 * Eine Zeile öffnet nicht über einen eigenen Klick, sondern über die gestreckte Fläche des Links in der
 * ersten Inhaltsspalte (`RowLink`/`RowButton`, docs/MUSTER.md § G; „Mittelweg Zeilenklick“, Fassung 0.2.6).
 * Nur so gibt es Cmd-Klick für einen neuen Tab, nur so ist es für Vorleser genau ein Link, und nur so
 * stören Haken, Schalter und Knöpfe in der Zeile nicht. Gefunden wird jeder Zeilen-Tag (`<TableRow`,
 * `<tr`) mit einem Klick-, Tasten- oder Zeiger-Zubehör — auch über mehrere Zeilen.
 */
const CLICK = /\bon(Click|DoubleClick|KeyDown|KeyUp|MouseDown|PointerDown)\s*=|\btabIndex\s*=|cursor-pointer|router\.push/;

describe('kein Klick an einer Tabellenzeile', () => {
  it('<TableRow> und <tr> tragen weder onClick noch onKeyDown, tabIndex oder cursor-pointer', () => {
    const violations = sourceFiles().flatMap((file) =>
      openingTags(read(file), /TableRow|tr/)
        .filter(({ tag }) => CLICK.test(tag))
        .map(({ line }) => `${relative(file)}:${line}`),
    );
    expect(violations).toEqual([]);
  });
});
