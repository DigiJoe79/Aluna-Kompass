import { createDeps, readEnv } from '../app';
import { seedDevelopment } from './seed';

const runtime = readEnv({ SESSION_SECRET: 'seed-only-not-a-real-secret-value-0000', ...process.env });
const deps = createDeps({ databasePath: runtime.databasePath, env: runtime.env });
try {
  const { adminEmail, adminPassword } = await seedDevelopment(deps);
  console.log(`Seed abgeschlossen. Login: ${adminEmail} / ${adminPassword}`);
} finally {
  deps.close();
}
