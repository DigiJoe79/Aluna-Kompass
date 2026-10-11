import { runtimeEnv } from '@/lib/deps';
import { iconPng } from '@/lib/env-icon-image';

/**
 * Icon für Safari-Favoriten und den iOS-Startbildschirm, 180 px ohne Rundung (iOS rundet selbst). Je Umgebung
 * wie das Tab-Icon: Gerade die Kacheln in Safari sollen Prod und Test unterscheiden (Joe 2026-10-11).
 */
export const dynamic = 'force-dynamic';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return iconPng(runtimeEnv().env, size.width, false);
}
