import { runtimeEnv } from '@/lib/deps';
import { iconSvg } from '@/lib/env-icon';

/** Tab-Icon je Umgebung. Als Route statt `icon.svg`, weil eine Datei für alle Umgebungen gälte. */
export const dynamic = 'force-dynamic';
export const contentType = 'image/svg+xml';

export default function Icon() {
  return new Response(iconSvg(runtimeEnv().env), { headers: { 'Content-Type': contentType } });
}
