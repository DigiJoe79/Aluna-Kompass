import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({ clearSessionCookie: async () => {} }));

/**
 * `new URL('/login', request.url)` baut eine absolute Adresse aus der Sicht des
 * Servers. Im Container ist das `http://0.0.0.0:3000` — die interne
 * Bindeadresse, unter der kein Browser die Anwendung erreicht. Hinter der
 * Portweiterleitung des NAS oder einem Reverse Proxy gilt dasselbe.
 * Eine relative Adresse löst der Browser gegen die Adresse auf, die er
 * tatsächlich benutzt hat.
 */
describe('logout', () => {
  it('redirects relative, not to the address the server binds to', async () => {
    const { POST } = await import('@/app/logout/route');
    const response = await POST();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });
});
