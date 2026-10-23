import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { ServiceError } from '@kompass/core';
import type { parseRange } from './http-range';

/**
 * Die Antwort eines Backup-Downloads: gestreamt von der Platte, nie ganz im Speicher (Prod-Backups haben Hunderte
 * Megabyte). Mit `Range` fortsetzbar.
 */
/** Einheit der HTTP-Bereiche (`Content-Range`, RFC 9110 § 14.4) — Technik, kein Oberflächentext. */
const RANGE_UNIT = 'bytes';

export function backupFileResponse(file: { archivePath: string; sizeBytes: number; fileName: string }, range: ReturnType<typeof parseRange>): Response {
  const base = {
    'content-type': 'application/x-tar',
    'content-disposition': `attachment; filename="${file.fileName}"`,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  };
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...base, 'content-range': `${RANGE_UNIT} */${file.sizeBytes}` } });
  const { start, end } = range ?? { start: 0, end: file.sizeBytes - 1 };
  const length = Math.max(0, end - start + 1);
  const body = length === 0 ? null : (Readable.toWeb(createReadStream(file.archivePath, { start, end })) as ReadableStream<Uint8Array>);
  return new Response(body, {
    status: range ? 206 : 200,
    headers: { ...base, 'content-length': String(length), ...(range ? { 'content-range': `${RANGE_UNIT} ${start}-${end}/${file.sizeBytes}` } : {}) },
  });
}

/** Status eines abgelehnten Backup-Dienstes für einen Route Handler. */
export function backupFailureStatus(error: ServiceError): number {
  if (error.type === 'forbidden') return 403;
  if (error.type === 'unauthorized') return 401;
  if (error.type === 'notFound') return 404;
  if (error.type === 'validation') return 400;
  return 409;
}

/** Abgelehnter Upload als Antwort: Prüfgrund 422, zu groß 413, sonst Status des Fehlers. Auch für die Ersteinrichtung. */
export function uploadFailure(error: ServiceError): Response {
  if (error.type === 'validation') return Response.json({ error: error.issues[0]?.message ?? 'validation' }, { status: 422 });
  if (error.type === 'forbidden') return new Response(null, { status: 403 });
  if (error.type === 'conflict') return Response.json({ error: error.code }, { status: error.code === 'backupTooLarge' ? 413 : 409 });
  return new Response(null, { status: 409 });
}
