import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';

export const letterSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().max(100_000),
  /** Fertiger, mehrzeiliger Anschriftsblock — im Service aufgelöst, nicht hier (Entscheidung 7). */
  recipient: z.string().max(500).default(''),
});

export const letterTemplate: DocumentTemplate<z.infer<typeof letterSchema>> = {
  key: 'letter',
  type: 'letter',
  schema: letterSchema,
  base: 'a4-mit-briefkopf',
  build: (data) => ({
    slots: { kind: 'letter', subject: data.subject, title: data.subject, recipient: data.recipient },
    body: { markdown: data.body },
  }),
};
