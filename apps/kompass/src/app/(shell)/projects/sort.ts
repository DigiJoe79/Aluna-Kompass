import type { ProjectRecord } from '@kompass/module-projects';
import type { SortDirection } from '@/lib/sort';

export const PROJECT_SORT_FIELDS = ['name', 'type'] as const;
export type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];

const label = (p: ProjectRecord) => p.name.de || p.slug;

/** Klein genug, um auf dem Server in der Seite zu sortieren; der Dienst liefert nach `sortOrder`. */
export function sortProjects(list: ProjectRecord[], sort: { field: ProjectSortField; direction: SortDirection } | undefined): ProjectRecord[] {
  if (!sort) return list;
  const key = sort.field === 'name' ? label : (p: ProjectRecord) => p.type;
  const sorted = [...list].sort((a, b) => key(a).localeCompare(key(b), 'de'));
  return sort.direction === 'asc' ? sorted : sorted.reverse();
}
