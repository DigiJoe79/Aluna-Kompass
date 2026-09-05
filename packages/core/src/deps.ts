import type { Clock } from './clock';
import type { Db } from './db/client';
import type { MediaStore } from './media/store';
import type { Registry } from './modules/registry';

export type AppEnv = 'development' | 'test' | 'production';

export interface Deps {
  db: Db;
  clock: Clock;
  env: AppEnv;
  registry: Registry;
  media: MediaStore;
}
