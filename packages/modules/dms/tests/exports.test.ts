import { describe, expect, it } from 'vitest';
import * as dms from '../src/index';

/** Was Dokumentdaten liefert, ohne zu wissen, wer fragt (Vorarbeiten-Spec § 5). */
const UNGUARDED = ['readDocumentText', 'fulltextHits', 'fulltextCondition', 'matchExpression', 'toRecord', 'relationsFor', 'notesFor', 'readDocumentFile', 'storeDocumentFile', 'removeDocumentFile', 'resolveRecipient', 'readableTypeFilter', 'readableTypeKeys'];

describe('the public surface of the file module', () => {
  it('exports no helper that reads document data without a caller', () => {
    expect(UNGUARDED.filter((name) => name in dms)).toEqual([]);
  });

  it('every exported function that takes a document id takes a ctx as well', () => {
    // Näherung, die hält: Eine exportierte Funktion, deren erster Parameter `deps`
    // heißt, hat als zweiten `ctx` — oder steht hier, mit Grund.
    const WITHOUT_CTX: Record<string, string> = {
      dmsRetentionHolds: 'Haken des Kerns, nennt nur Nummern',
      dmsRetentionDue: 'Haken des Kerns, nennt nur Nummern',
      dmsRecordReferences: 'Haken des Kerns, bei geschützten Arten nur die Nummer',
      dmsFollowUpTargets: 'Haken des Kerns, bei geschützten Arten nur die Nummer',
      dmsGatePermissions: 'liefert Rechteschlüssel, keine Dokumentdaten',
      defaultTypeKey: 'Einstellung', isDefaultType: 'Einstellung', dispatchChannels: 'Einstellung', ocrLanguages: 'Einstellung',
      installDms: 'install-Haken', seedDms: 'seed-Haken', startTextWorker: 'Worker',
      recoverRunning: 'Worker: setzt hängende Aufträge zurück, gibt keine Dokumentdaten aus',
      requeueUnavailable: 'Worker: reiht wartende Aufträge ein, gibt keine Dokumentdaten aus',
      processNextDocument: 'Worker: liest den nächsten Auftrag in den Index, gibt keine Dokumentdaten aus',
      templateKeyForType: 'bildet einen Artschlüssel auf einen Vorlagenschlüssel ab, keine Dokumentdaten',
      refuseReservedLinks: 'prüft Bezugstypen der Eingabe und liefert nur einen Fehler, keine Dokumentdaten',
    };
    const offenders = Object.entries(dms)
      .filter(([, value]) => typeof value === 'function')
      .filter(([name, fn]) => /^(async\s+)?function\s*\w*\s*\(\s*deps\s*[,)]/.test(String(fn)) && !/^(async\s+)?function\s*\w*\s*\(\s*deps\s*,\s*ctx\b/.test(String(fn)) && !(name in WITHOUT_CTX));
    expect(offenders.map(([name]) => name)).toEqual([]);
  });
});
