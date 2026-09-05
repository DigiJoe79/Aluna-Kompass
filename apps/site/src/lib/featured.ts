import type { Animal, Facts } from './content';

export function featuredAnimal(animals: Animal[], facts: Facts): Animal | null {
  const open = animals.filter((a) => a.status !== 'adopted');
  if (facts.featuredAnimalSlug !== 'auto') return open.find((a) => a.slug === facts.featuredAnimalSlug) ?? null;
  return open.find((a) => a.isEmergency) ?? open[open.length - 1] ?? null;
}

export function featuredStory(animals: Animal[], facts: Facts): Animal | null {
  const done = animals.filter((a) => a.status === 'adopted' && a.story);
  if (facts.featuredStorySlug !== 'auto') return done.find((a) => a.slug === facts.featuredStorySlug) ?? null;
  return [...done].sort((a, b) => b.story!.adoptedYear - a.story!.adoptedYear)[0] ?? null;
}
