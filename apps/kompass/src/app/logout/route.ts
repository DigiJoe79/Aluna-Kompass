import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/request-context';

export async function POST(): Promise<Response> {
  await clearSessionCookie();
  // Relativ, nicht `new URL('/login', request.url)`: Im Container ist die
  // Adresse aus Sicht des Servers `http://0.0.0.0:3000`, und dorthin kommt
  // kein Browser. Hinter einer Portweiterleitung oder einem Reverse Proxy
  // gilt dasselbe.
  return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
}
