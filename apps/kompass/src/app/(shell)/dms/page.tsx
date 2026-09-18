import { DmsView, type DmsQuery } from './dms-view';

export default async function DmsPage(props: { searchParams: Promise<DmsQuery> }) {
  return <DmsView query={await props.searchParams} />;
}
