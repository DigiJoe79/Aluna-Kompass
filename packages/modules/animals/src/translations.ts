import { notFound, ok, requirePermission, type CallContext, type Deps, type LocalizedValue, type Result, type Translatable, type TranslationWrite } from '@kompass/core';
import { asc } from 'drizzle-orm';
import { animals } from './schema';
import { loadAnimal, setAnimalStory, updateAnimal, type AnimalRecord } from './service';

const PROFILE_FIELDS = ['birthText', 'sizeText', 'traits', 'summary', 'body'] as const;
const STORY_FIELDS = ['quote', 'beforeCaption', 'afterCaption'] as const;
type ProfileField = (typeof PROFILE_FIELDS)[number];
type StoryField = (typeof STORY_FIELDS)[number];

const isProfileField = (f: string): f is ProfileField => (PROFILE_FIELDS as readonly string[]).includes(f);
const storyFieldOf = (f: string): StoryField | null => {
  const name = f.startsWith('story.') ? f.slice('story.'.length) : '';
  return (STORY_FIELDS as readonly string[]).includes(name) ? (name as StoryField) : null;
};

function fieldsOf(a: AnimalRecord): Translatable['fields'] {
  const fields: Translatable['fields'] = {};
  for (const f of PROFILE_FIELDS) fields[f] = a[f] as Record<string, LocalizedValue>;
  if (a.story) for (const f of STORY_FIELDS) fields[`story.${f}`] = a.story[f];
  return fields;
}

/** Alle Tiere, auch unveröffentlichte — die Lückenliste ist eine Verwaltungssicht. */
export function animalsTranslatables(deps: Deps, ctx: CallContext): Result<Translatable[]> {
  const denied = requirePermission(ctx, 'animals.view');
  if (denied) return denied;
  const rows = deps.db.select({ id: animals.id }).from(animals).orderBy(asc(animals.name)).all().map((r) => loadAnimal(deps.db, r.id)!);
  return ok(rows.map((a) => ({ entityType: 'animal', id: a.id, label: a.name, href: `/animals/${a.id}`, fields: fieldsOf(a) })));
}

/**
 * Profilfelder über `updateAnimal`, Geschichte über `setAnimalStory` — zwei
 * Services, also bis zu zwei Aufrufe je Tier; innerhalb jedes Aufrufs nur die
 * genannten Sprachschlüssel ersetzt.
 */
export function animalsSetTranslations(deps: Deps, ctx: CallContext, input: TranslationWrite): Promise<Result<unknown>> | null {
  if (input.entityType !== 'animal') return null;
  return (async () => {
    const denied = requirePermission(ctx, 'animals.manage');
    if (denied) return denied;
    const before = loadAnimal(deps.db, input.id);
    if (!before) return notFound('animal', input.id);

    const profile: Partial<Record<ProfileField, Record<string, LocalizedValue>>> = {};
    const story: Partial<Record<StoryField, Record<string, string>>> = {};
    for (const item of input.items) {
      if (isProfileField(item.field)) {
        const current = profile[item.field] ?? (before[item.field] as Record<string, LocalizedValue>);
        profile[item.field] = { ...current, [item.locale]: item.text };
        continue;
      }
      const storyField = storyFieldOf(item.field);
      if (!storyField || !before.story || typeof item.text !== 'string') return notFound('field', item.field);
      const current = story[storyField] ?? before.story[storyField];
      story[storyField] = { ...current, [item.locale]: item.text };
    }

    if (Object.keys(profile).length > 0) {
      const updated = await updateAnimal(deps, ctx, { id: input.id, ...profile });
      if (!updated.ok) return updated;
    }
    if (Object.keys(story).length > 0 && before.story) {
      const { beforeAssetId, afterAssetId, quote, family, adoptedYear, beforeCaption, afterCaption } = before.story;
      const written = await setAnimalStory(deps, ctx, { id: input.id, beforeAssetId, afterAssetId, family, adoptedYear, quote, beforeCaption, afterCaption, ...story });
      if (!written.ok) return written;
    }
    return ok(null);
  })();
}
