import type { CallContext } from '../context';
import { projects } from '../db/schema';
import type { Deps } from '../deps';
import { unwrap } from '../result';
import { createProject, setProjectPublished } from '../projects/service';

/**
 * Beispielprojekte für Entwicklung und Test — frei erfunden, weil das Repo
 * öffentlich ist. In `development` liegen sie neben den Prototyp-Daten, die
 * `dev:reset` danach einspielt; sie füllen die Liste, wenn kein Prototyp da ist.
 */
const EXAMPLE_PROJECTS = [
  {
    slug: 'winterhilfe',
    name: { de: 'Winterhilfe für Streuner', en: 'Winter aid for strays' },
    type: 'ongoing' as const,
    status: 'active' as const,
    summary: { de: 'Futterstellen und Schlafboxen über die kalten Monate.', en: 'Feeding stations and shelter boxes through the cold months.' },
    body: { de: 'Von November bis März werden feste Futterstellen betreut und isolierte Schlafboxen aufgestellt.', en: 'From November to March, fixed feeding stations are maintained and insulated shelter boxes are set up.' },
    published: true,
  },
  {
    slug: 'kastrationsaktion-2026',
    name: { de: 'Kastrationsaktion 2026', en: 'Neutering campaign 2026' },
    type: 'shortTerm' as const,
    status: 'active' as const,
    summary: { de: 'Eine Woche mobile Tierarztpraxis in der Region.', en: 'A week of mobile veterinary care in the region.' },
    body: { de: 'Ein Team aus Tierärztinnen kastriert eine Woche lang freilebende Katzen und dokumentiert jeden Eingriff.', en: 'A team of vets neuters free-roaming cats for a week and documents every procedure.' },
    published: false,
  },
  {
    slug: 'auslauf-am-heim',
    name: { de: 'Auslauf am Heim', en: 'Exercise yard at the home' },
    type: 'shortTerm' as const,
    status: 'completed' as const,
    summary: { de: 'Ein eingezäunter Auslauf für die Hunde, 2025 fertiggestellt.', en: 'A fenced exercise yard for the dogs, finished in 2025.' },
    body: { de: 'Der Auslauf wurde 2025 gebaut und dient hier als Beispiel für ein abgeschlossenes Projekt.', en: 'The yard was built in 2025 and serves here as an example of a completed project.' },
    published: false,
  },
];

/** Legt die Beispielprojekte an, sofern noch keine Projekte existieren. */
export async function seedProjects(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: projects.id }).from(projects).all().length > 0) return;
  for (const p of EXAMPLE_PROJECTS) {
    const created = unwrap(await createProject(deps, ctx, { slug: p.slug, name: p.name, type: p.type, status: p.status, summary: p.summary, body: p.body }));
    if (p.published) unwrap(await setProjectPublished(deps, ctx, { id: created.id, isPublished: true }));
  }
}
