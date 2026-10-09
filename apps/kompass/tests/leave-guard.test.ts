// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { leavingLink } from '@/lib/leave-guard';

// Links lösen gegen die Adresse des Dokuments auf, die Herkunft muss also dieselbe sein.
const HERE = { href: `${window.location.origin}/admin/settings?panel=organization` };

function click(link: Element, init: MouseEventInit = {}) {
  let event!: MouseEvent;
  link.addEventListener('click', (e) => { event = e as MouseEvent; e.preventDefault(); }, { once: true });
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  return event;
}

function anchor(href: string, attrs: Record<string, string> = {}, parent: Element = document.body) {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  a.textContent = 'x';
  parent.appendChild(a);
  return a;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('leavingLink', () => {
  it('ein gewöhnlicher Klick auf eine andere Seite verlässt sie — auch auf ein Kind des Links', () => {
    const a = anchor('/projects');
    const span = document.createElement('span');
    a.appendChild(span);
    const event = new MouseEvent('click', { button: 0 });
    Object.defineProperty(event, 'target', { value: span });
    expect(leavingLink(event, HERE)).toBe(a);
    // Ohne Link kein Verlassen.
    const plain = new MouseEvent('click', { button: 0 });
    Object.defineProperty(plain, 'target', { value: document.body });
    expect(leavingLink(plain, HERE)).toBeNull();
  });

  it('Tab, neues Fenster, Herunterladen und fremde Herkunft fängt es nicht ab', () => {
    const at = (a: Element, init: MouseEventInit = {}) => {
      const event = new MouseEvent('click', { button: 0, ...init });
      Object.defineProperty(event, 'target', { value: a });
      return leavingLink(event, HERE);
    };
    const a = anchor('/projects');
    expect(at(a, { metaKey: true })).toBeNull();
    expect(at(a, { ctrlKey: true })).toBeNull();
    expect(at(a, { shiftKey: true })).toBeNull();
    expect(at(a, { button: 1 })).toBeNull();
    expect(at(anchor('/projects', { target: '_blank' }))).toBeNull();
    expect(at(anchor('/export.csv', { download: '' }))).toBeNull();
    expect(at(anchor('https://example.org/'))).toBeNull();
    expect(at(anchor('/admin/settings?panel=organization#abschnitt'))).toBeNull();
    expect(at(anchor('/projects', { target: '_self' }))).toBe(document.body.lastElementChild);
  });

  it('ein Bereichswechsel in der Formularkarte bleibt, derselbe Pfad außerhalb nicht', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);
    const at = (a: Element) => {
      const event = new MouseEvent('click', { button: 0 });
      Object.defineProperty(event, 'target', { value: a });
      return leavingLink(event, HERE, card);
    };
    expect(at(anchor('/admin/settings?panel=contact', {}, card))).toBeNull();
    const outside = anchor('/admin/settings?panel=contact');
    expect(at(outside)).toBe(outside);
    const away = anchor('/admin/users', {}, card);
    expect(at(away)).toBe(away);
  });

  it('ein schon abgefangener Klick zählt nicht', () => {
    const a = anchor('/projects');
    expect(click(a).defaultPrevented).toBe(true);
    const event = click(a);
    Object.defineProperty(event, 'target', { value: a });
    expect(leavingLink(event, HERE)).toBeNull();
  });
});
