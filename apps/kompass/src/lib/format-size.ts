const MB = 1024 * 1024;
const GB = 1024 * MB;
const TB = 1024 * GB;

const oneDecimal = (n: number) => n.toFixed(1).replace('.', ',');

/**
 * Größe eines Backups (oder Datenträgers) für Menschen: unter einem GB ganze MB („641 MB“), darunter eine Stelle GB
 * („9,8 GB“), darüber TB („1,2 TB“). 1024er-Basis, Komma wie `admin/media/types.ts`. Größen nie roh anzeigen.
 */
export function formatSize(bytes: number): string {
  if (bytes >= TB) return `${oneDecimal(bytes / TB)} TB`;
  if (bytes >= GB) return `${oneDecimal(bytes / GB)} GB`;
  return `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / MB))} MB`;
}
