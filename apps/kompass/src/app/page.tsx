import { requireSession } from '@/lib/request-context';

export default async function Page() {
  const { user } = await requireSession();
  return <main className="p-8">Guten Tag, {user.name.split(' ')[0]}.</main>;
}
