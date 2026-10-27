import { AO52_PURPOSES } from '@kompass/module-finance/format';

/**
 * Die Zwecke des § 52 Abs. 2 AO als Optionen eines `Select` (Designer Runde 7, Abweichung 6): „Nr. 14 · die Förderung
 * des Tierschutzes“. Gespeichert wird die Nummer; die leere Option nennt `emptyLabel`.
 */
export function Ao52Options({ emptyLabel, numberLabel }: { emptyLabel: string; numberLabel: (n: number) => string }) {
  return (
    <>
      <option value="">{emptyLabel}</option>
      {AO52_PURPOSES.map((p) => (
        <option key={p.number} value={String(p.number)}>
          {`${numberLabel(p.number)} · ${p.text}`}
        </option>
      ))}
    </>
  );
}
