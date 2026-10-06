import { Page } from '@/components/page';
import { DmsView, type DmsQuery } from './dms-view';

/** Liste mit Ordnerspalte: eine Arbeitsfläche, darum `full` (Handoff Konsistenz § 8c). */
export default async function DmsPage(props: { searchParams: Promise<DmsQuery> }) {
  return (
    <Page width="full">
      <DmsView query={await props.searchParams} />
    </Page>
  );
}
