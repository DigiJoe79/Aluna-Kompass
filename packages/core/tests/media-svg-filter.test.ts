import { describe, expect, it } from 'vitest';
import { storeMediaAsset } from '../src/media/service';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

/**
 * Ein SVG ist ein Dokument: Was der Filter durchlässt, läuft — eingebunden in die
 * Webseite oder direkt aufgerufen — im Ursprung, der es ausliefert. Der Filter
 * dekodiert deshalb Zeichenreferenzen, bevor er sucht, und lehnt jede Hülle ab,
 * die fremdes HTML oder ein Skript-Schema trägt.
 */
async function upload(svg: string) {
  const deps = createTestDeps();
  const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
  return storeMediaAsset(deps, ctx, { originalName: 'x.svg', bytes: new TextEncoder().encode(svg), declaredMimeType: 'image/svg+xml' });
}

const refused = async (svg: string): Promise<boolean> => {
  const result = await upload(svg);
  return result.ok === false && result.error.type === 'validation' && result.error.issues[0]?.message === 'svgContainsScript';
};

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

describe('svg upload filter', () => {
  it.each([
    ['foreignObject with an iframe srcdoc in entities', `<svg ${NS}><foreignObject width="10" height="10"><iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/></foreignObject></svg>`],
    ['javascript scheme hidden behind a numeric reference', `<svg ${NS}><a href="javascript&#58;alert(1)"><rect width="1" height="1"/></a></svg>`],
    ['javascript scheme hidden behind a hex reference', `<svg ${NS}><a xlink:href="javascript&#x3A;alert(1)"><rect width="1" height="1"/></a></svg>`],
    ['javascript scheme hidden behind a named reference', `<svg ${NS}><a href="javascript&colon;alert(1)"><rect width="1" height="1"/></a></svg>`],
    ['a script tag written as references', `<svg ${NS}>&#60;script&#62;alert(1)&#60;/script&#62;</svg>`],
    ['an event handler', `<svg ${NS} onload="alert(1)"/>`],
    ['an iframe', `<svg ${NS}><iframe src="https://example.org"/></svg>`],
    ['an embed', `<svg ${NS}><embed src="x"/></svg>`],
    ['an object', `<svg ${NS}><object data="x"/></svg>`],
    ['a foreignObject without anything inside', `<svg ${NS}><foreignObject/></svg>`],
    ['a data url that is not an image', `<svg ${NS}><use href="data:text/html;base64,PHNjcmlwdD4="/></svg>`],
    ['an unknown scheme', `<svg ${NS}><image href="vbscript:x"/></svg>`],
  ])('refuses %s', async (_name, svg) => {
    expect(await refused(svg)).toBe(true);
  });

  it.each([
    // Der Haken aus dem Seed (`packages/core/src/seed/media.ts`) — im Repo liegt sonst kein SVG.
    ['the seed icon', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="28" fill="none" stroke="#5b6f8c" stroke-width="4"/><path d="M20 34l8 8 16-18" fill="none" stroke="#5b6f8c" stroke-width="4"/></svg>'],
    [
      'an Inkscape export with namespaces, entities, internal references and an embedded raster',
      `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="20" height="20" sodipodi:docname="logo.svg">
  <defs><linearGradient id="a"><stop offset="0" style="stop-color:#fff"/></linearGradient><linearGradient xlink:href="#a" id="b"/></defs>
  <text x="1" y="10">Tier&#160;&amp;&#x20;Mensch</text>
  <use href="#b"/>
  <image width="1" height="1" xlink:href="data:image/png;base64,iVBORw0KGgo="/>
  <a href="https://example.org/verein"><rect width="5" height="5"/></a>
</svg>`,
    ],
  ])('accepts %s', async (_name, svg) => {
    const result = await upload(svg);
    expect(result.ok).toBe(true);
  });
});
