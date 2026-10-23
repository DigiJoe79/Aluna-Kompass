import { maintenanceView } from '@kompass/core';
import { runtimeEnv } from '@/lib/deps';

export const dynamic = 'force-dynamic';

/** Stand des Einspielens für die Wartungsseite — ohne Sitzung und ohne Datenbank, die gerade ausgetauscht wird. */
export async function GET(): Promise<Response> {
  return Response.json(maintenanceView(runtimeEnv().backupPath, new Date()), { headers: { 'cache-control': 'no-store' } });
}
