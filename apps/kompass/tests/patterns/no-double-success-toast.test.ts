import { describe, expect, it } from 'vitest';
import { read, relative, sourceFiles } from './source';

/**
 * `useActionFeedback().run` sagt einen Erfolg mit Text selbst als Toast an (MUSTER § A). Ruft die Aufrufstelle danach noch
 * einmal `toast.success(result.message)`, stapeln sich zwei gleiche Toasts — der „zweite, leere Rahmen dahinter“ im
 * Bild 255 (Designer Runde 7). Gesucht: eine Zuweisung `const x = await ….run(…)` und danach, bevor `x` neu entsteht,
 * `toast.success(x.message)`.
 */
export function doubleToasts(source: string): number[] {
  const lines = source.split('\n');
  const hits: number[] = [];
  let lastRun: { name: string; at: number } | null = null;
  lines.forEach((line, i) => {
    const run = /const (\w+) = await \w+\.run\(/.exec(line);
    if (run) lastRun = { name: run[1]!, at: i };
    else if (/const (\w+) =/.test(line) && lastRun && line.includes(`const ${lastRun.name} =`)) lastRun = null;
    if (lastRun && i - lastRun.at <= 20 && line.includes(`toast.success(${lastRun.name}.message)`)) hits.push(i + 1);
  });
  return hits;
}

describe('kein zweiter Erfolgs-Toast nach useActionFeedback().run', () => {
  it('no call site toasts the message run already announced', () => {
    const offenders = sourceFiles()
      .filter((f) => /\.tsx?$/.test(f))
      .flatMap((f) => doubleToasts(read(f)).map((line) => `${relative(f)}:${line}`));
    expect(offenders).toEqual([]);
  });

  it('Gegenprobe: finds the pattern, but not a toast after a plain action call', () => {
    expect(doubleToasts(['const result = await feedback.run(() => save());', 'if (result.status !== "success") return;', 'toast.success(result.message);'].join('\n'))).toEqual([3]);
    expect(doubleToasts(['const result = await saveAction();', 'toast.success(result.message);'].join('\n'))).toEqual([]);
  });
});
