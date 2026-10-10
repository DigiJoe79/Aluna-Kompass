export type AnimalView = 'all' | 'review' | 'proposals';

/**
 * Welche Reiter die Tierliste zeigt (Spec Vorschläge § 4, § 6; Board 1d/1e): „Prüfung offen“ mit der Einstellung
 * oder solange Tiere markiert sind; „Vorschläge“ nur mit `animals.manage` (die Lesedienste verlangen es), mit der
 * Einstellung oder solange Vorschläge offen sind.
 */
export function animalViewTabs(o: { canManage: boolean; reviewSetting: boolean; reviewPendingTotal: number; proposalsSetting: boolean; openProposals: number }): AnimalView[] {
  const views: AnimalView[] = ['all'];
  if (o.reviewSetting || o.reviewPendingTotal > 0) views.push('review');
  if (o.canManage && (o.proposalsSetting || o.openProposals > 0)) views.push('proposals');
  return views;
}
