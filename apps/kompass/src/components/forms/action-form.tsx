'use client';

import { createContext, useEffect, useRef, useTransition, type ComponentProps, type FormEvent } from 'react';

/** Ob die Aktion des umgebenden `ActionForm` läuft — `SubmitButton` liest es. */
export const ActionFormPending = createContext<boolean | null>(null);

/**
 * Ein Formular, das seine Eingaben behält, wenn der Server ablehnt.
 *
 * React 19 setzt ein `<form action={fn}>` nach **jedem** Durchlauf zurück: Alle
 * Felder mit `defaultValue` springen auf den Ladestand, auch wenn der Dienst
 * mit einem Validierungsfehler oder einem Konflikt geantwortet hat. Wer einen
 * langen Text getippt und sich beim Slug vertan hatte, stand vor einer leeren
 * Maske (gefunden 2026-09-19 beim Versionsstempel, Backlog 20).
 *
 * Hier wird selbst abgeschickt, über `onSubmit` in einer Transition — dann
 * setzt React nichts zurück. Nach einem **Erfolg** wird trotzdem
 * zurückgesetzt, wie bisher: Die Felder zeigen dann den neuen Ladestand, und
 * ein Anlegen-Formular steht wieder leer da.
 */
export function ActionForm({
  action,
  state,
  ...props
}: Omit<ComponentProps<'form'>, 'action' | 'onSubmit'> & {
  action: (formData: FormData) => void;
  /** Der Zustand aus `useActionState` — nur `status: 'success'` setzt zurück. */
  state: { status: string };
}) {
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (!submitted.current) return;
    submitted.current = false;
    if (state.status === 'success') form.current?.reset();
  }, [state]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    submitted.current = true;
    startTransition(() => action(data));
  };

  return (
    <ActionFormPending.Provider value={pending}>
      <form ref={form} {...props} onSubmit={submit} />
    </ActionFormPending.Provider>
  );
}
