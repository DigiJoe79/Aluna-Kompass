import { createHash } from 'node:crypto';
import { invalid, ok, type Deps, type Result } from '@kompass/core';
import { fileTypeFromBuffer } from 'file-type';

/** Der Schlüssel dieses Moduls — zugleich sein Verzeichnis unter `dataPath`. */
export const DMS_MODULE_KEY = 'dms';

/** Dieselbe Grenze wie in der Mediathek; ein eingescanntes Schreiben bleibt darunter. */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export interface StoredFile {
  fileName: string;
  fileChecksum: string;
  fileBytes: number;
}

/**
 * Schriftverkehr ist PDF. Geprüft wird der Inhalt, nicht die Endung — eine
 * umbenannte `.docx` ist kein Schreiben, das in zehn Jahren noch lesbar sein
 * muss.
 */
async function isPdf(bytes: Uint8Array): Promise<boolean> {
  const sniffed = await fileTypeFromBuffer(bytes);
  return sniffed?.mime === 'application/pdf';
}

/**
 * Legt die Datei im Speicher der Akte ab. Der Name kommt aus der Dokument-ID,
 * nicht aus dem Inhalt: Anders als die Mediathek fasst die Akte zwei
 * inhaltsgleiche Dateien **nicht** zusammen — zwei Schreiben an verschiedene
 * Empfänger sind zwei Vorgänge, und der eine darf nicht verschwinden, wenn der
 * andere gelöscht wird.
 */
export async function storeDocumentFile(deps: Deps, documentId: string, bytes: Uint8Array): Promise<Result<StoredFile>> {
  if (bytes.byteLength > DOCUMENT_MAX_BYTES) return invalid([{ path: 'file', message: 'fileTooLarge' }]);
  if (!(await isPdf(bytes))) return invalid([{ path: 'file', message: 'notAPdf' }]);

  const fileName = `${documentId.toLowerCase()}.pdf`;
  await deps.files(DMS_MODULE_KEY).write(fileName, bytes);

  return ok({
    fileName,
    fileChecksum: createHash('sha256').update(bytes).digest('hex'),
    fileBytes: bytes.byteLength,
  });
}

export function readDocumentFile(deps: Deps, fileName: string): Promise<Uint8Array> {
  return deps.files(DMS_MODULE_KEY).read(fileName);
}

export function removeDocumentFile(deps: Deps, fileName: string): Promise<void> {
  return deps.files(DMS_MODULE_KEY).delete(fileName);
}
