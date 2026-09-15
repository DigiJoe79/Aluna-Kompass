import { describe, expect, it } from 'vitest';
import { cookieShouldBeSecure } from '@/lib/secure-cookie';

/**
 * `secure: false` stand fest im Code, begruendet mit „laeuft nur im LAN ohne
 * TLS". Das stimmt fuer die Vorgabe und bleibt so — aber sobald jemand einen
 * Reverse Proxy mit TLS davorstellt, schickt der Browser das Sitzungscookie
 * weiter ueber Klartext mit, und ein Mitleser im selben Netz hat die Sitzung.
 *
 * Umgekehrt darf die Erkennung nicht raten: Ein `secure`-Cookie ueber http
 * wird vom Browser verworfen, und dann meldet sich niemand mehr an. Ohne
 * Hinweis auf TLS bleibt es deshalb bei `false`.
 */
describe('session cookie', () => {
  it('stays open where there is no TLS — the default in a club network', () => {
    expect(cookieShouldBeSecure(null)).toBe(false);
    expect(cookieShouldBeSecure('http')).toBe(false);
  });

  it('closes as soon as a proxy reports TLS', () => {
    expect(cookieShouldBeSecure('https')).toBe(true);
    expect(cookieShouldBeSecure('HTTPS')).toBe(true);
  });

  /** Mehrere Proxys haengen an; der erste Eintrag ist der zum Client hin. */
  it('reads the first hop of a chain, like x-forwarded-for', () => {
    expect(cookieShouldBeSecure('https, http')).toBe(true);
    expect(cookieShouldBeSecure('http, https')).toBe(false);
  });

  it('is not fooled by whitespace or an empty header', () => {
    expect(cookieShouldBeSecure('  https  ')).toBe(true);
    expect(cookieShouldBeSecure('')).toBe(false);
  });
});
