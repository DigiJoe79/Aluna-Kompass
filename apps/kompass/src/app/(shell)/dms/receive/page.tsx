import { DmsView, type DmsQuery } from '../dms-view';

/** Deep-Link: dieselbe Liste, der Dialog darüber schon offen. */
export default async function ReceivePage(props: { searchParams: Promise<DmsQuery> }) {
  return <DmsView query={await props.searchParams} receive />;
}
