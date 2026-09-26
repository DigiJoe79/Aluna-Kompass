import { backgroundStarted } from '@/lib/background';
import { appVersion, buildId } from '@/lib/build';
import { getDeps, runtimeEnv } from '@/lib/deps';

export const dynamic = 'force-dynamic';

/** `createDeps` wirft diesen Satz, wenn eine Dateiablage nicht beschreibbar ist (Befundliste, N10). */
const UNWRITABLE_PREFIX = 'Datenverzeichnis nicht beschreibbar';

export async function GET(): Promise<Response> {
  try {
    const deps = getDeps();
    return Response.json({
      status: 'ok',
      environment: runtimeEnv().env,
      migrationCount: deps.migrationCount,
      background: backgroundStarted(),
      version: appVersion(),
      build: buildId(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Statt eines unbehandelten Next-Fehlers: eine Meldung, die sagt, was fehlt — kein stiller 500 erst beim ersten Upload.
    const filesUnwritable = message.startsWith(UNWRITABLE_PREFIX);
    return Response.json({ status: 'error', ...(filesUnwritable ? { files: 'unwritable' as const } : {}), message }, { status: 503 });
  }
}
