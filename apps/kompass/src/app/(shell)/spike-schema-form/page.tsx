// WEGWERF — Feldstudie zur Maskenerzeugung, nicht committen.
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { examplePageTemplate } from './example-template';
import { SchemaForm } from './schema-form';

export const dynamic = 'force-dynamic';

export default function SpikePage() {
  const schema = z.toJSONSchema(examplePageTemplate, { io: 'input' }) as never;
  return (
    <div className="flex max-w-[980px] flex-col gap-4">
      <PageHeader title="Feldstudie: Maske aus Schema" description="Die Maske unten ist nicht geschrieben, sondern aus dem Zod-Schema eines Beispiel-Templates erzeugt. Drei Sprachen, weil das Template drei deklariert." />
      <SchemaForm schema={schema} initial={{ title: { de: 'Über uns', en: 'About us', fr: '' }, lede: { de: '', en: '', fr: '' }, body: { de: '## Wer wir sind\n\nText mit *Markdown*.', en: '', fr: '' }, heroImage: null, publishedFrom: '2026-09-07', layout: 'narrow', keywords: ['verein'], metrics: [{ label: { de: 'Mitglieder', en: 'Members', fr: '' }, value: 128, suffix: '' }], blocks: [] }} />
    </div>
  );
}
