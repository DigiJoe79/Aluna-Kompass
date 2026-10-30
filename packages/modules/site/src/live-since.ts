import type { Deps } from '@kompass/core';
import { and, desc, eq } from 'drizzle-orm';
import { BASELINE_ENVIRONMENT } from './pending';
import { readPublicContent, type ContentManifest } from './public-content';
import { sitePublishes } from './schema';
import { activeTemplate } from './service';

/**
 * Seit wann die Zeile `views.<view>:<href>` mit ihrem heutigen Stand auf der Webseite steht: der Beginn des ältesten
 * erfolgreichen Publish der Produktion, ab dem jeder spätere erfolgreiche Publish sie mit demselben Hash festhielt.
 * `null`, wenn die Sicht die Zeile heute nicht liefert, sie seit dem letzten Publish geändert wurde oder noch nie
 * online war. Ein Publish ohne festgehaltenen Stand (vor 0.2.10) beendet die Kette. Nur lesend; für den Haken
 * `publishedLiveSince` (etwa „Auf der Webseite seit …“ einer Jahresrechnung).
 */
export function publishedLiveSinceInternal(deps: Deps, view: string, href: string): string | null {
  const template = activeTemplate(deps);
  if (!template) return null;
  const content = readPublicContent(deps, template);
  if (!content.ok) return null;
  const key = `views.${view}:${href}`;
  const hash = content.value.items.find((i) => i.key === key)?.hash;
  if (!hash) return null;
  const publishes = deps.db
    .select({ startedAt: sitePublishes.startedAt, manifest: sitePublishes.contentManifest })
    .from(sitePublishes)
    .where(and(eq(sitePublishes.environment, BASELINE_ENVIRONMENT), eq(sitePublishes.status, 'success')))
    .orderBy(desc(sitePublishes.startedAt))
    .all();
  let since: string | null = null;
  for (const p of publishes) {
    if (!p.manifest || (JSON.parse(p.manifest) as ContentManifest)[key]?.hash !== hash) break;
    since = p.startedAt;
  }
  return since;
}
