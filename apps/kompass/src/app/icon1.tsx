import { runtimeEnv } from '@/lib/deps';
import { iconPng } from '@/lib/env-icon-image';

/** Tab-Icon als PNG neben dem SVG (`icon.tsx`): Safari zeigt im Tab kein SVG-Icon. 64 px für scharfe Retina-Tabs. */
export const dynamic = 'force-dynamic';
export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function IconPng() {
  return iconPng(runtimeEnv().env, size.width, true);
}
