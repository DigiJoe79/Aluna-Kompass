"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { SectionLevel } from "@/components/section"
import { XIcon } from "lucide-react"
import { useTranslations } from "next-intl"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-overlay/25 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

type DialogSize = "sm" | "md" | "lg" | "xl"

const DIALOG_SIZE: Record<DialogSize, string> = {
  sm: "sm:max-w-dialog-sm",
  md: "sm:max-w-dialog-md",
  lg: "sm:max-w-dialog-lg",
  xl: "sm:max-w-dialog-xl",
}

// Vorbilder: `site/publish/confirm-dialog.tsx` (Blatt) und `site/publish/log-dialog.tsx` (Vollbild).
const DIALOG_MOBILE = {
  sheet: "max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none",
  full: "max-sm:h-full max-sm:max-h-full max-sm:max-w-full max-sm:rounded-none",
} as const

function DialogContent({
  className,
  children,
  showCloseButton = true,
  layout = "default",
  size,
  mobile,
  onEscapeKeyDown,
  onPointerDownOutside,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /**
   * `fixed-footer` (N3, C1-1; HANDOFF § 13.2): höchstens 85 % der Höhe, Kopf
   * (`DialogHeader`) und Fußleiste (`DialogFooter`) stehen, nur die Mitte
   * (`DialogBody`) scrollt — die Hauptaktion bleibt bei jeder Länge sichtbar.
   */
  layout?: "default" | "fixed-footer"
  /**
   * Breite und Polster (docs/MUSTER.md § I, Handoff Konsistenz § 8a.4): `sm` 440 (bestätigen, ein bis zwei
   * Felder), `md` 560 (Formular in einer Spalte, innen ~512 px), `lg` 760 (zwei Spalten, Auswahl mit Liste),
   * `xl` 1040 (mit Vorschau). Keine eigene Breite und kein eigenes `--dialog-pad` an der Aufrufstelle.
   * Pflicht und ohne Standard (Handoff § 8c): So wird kein Dialog ungefragt breiter oder schmaler.
   */
  size: DialogSize
  /** Telefon (< 640): `sm`/`md` kommen als Blatt von unten, `lg`/`xl` als Vollbild; `mobile` übersteuert das. */
  mobile?: "sheet" | "full"
  onEscapeKeyDown?: (e: React.KeyboardEvent | Event) => void
  onPointerDownOutside?: (e: Event) => void
}) {
  const t = useTranslations("common")
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-layout={layout}
        className={cn(
          "group/dialog fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-surface text-sm text-ink ring-1 ring-line duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          DIALOG_SIZE[size],
          "p-5 [--dialog-pad:1.25rem]",
          DIALOG_MOBILE[mobile ?? (size === "sm" || size === "md" ? "sheet" : "full")],
          layout === "fixed-footer" && "flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 [--dialog-pad:0px]",
          className
        )}
        onKeyDown={(e) => {
          if (e.key === "Escape" && onEscapeKeyDown) {
            onEscapeKeyDown(e)
          }
          props.onKeyDown?.(e)
        }}
        {...props}
      >
        <SectionLevel level={3}>{children}</SectionLevel>
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                // 32 px sichtbar, 44 px Klickfläche — wie im Seitenfenster (K10 § 4.6).
                className="absolute top-3 right-3 after:absolute after:-inset-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">{t('close')}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 group-data-[layout=fixed-footer]/dialog:flex-none group-data-[layout=fixed-footer]/dialog:border-b group-data-[layout=fixed-footer]/dialog:border-line group-data-[layout=fixed-footer]/dialog:px-5 group-data-[layout=fixed-footer]/dialog:pt-4 group-data-[layout=fixed-footer]/dialog:pb-3 group-data-[layout=fixed-footer]/dialog:pr-12", className)}
      {...props}
    />
  )
}

/** Die scrollende Mitte eines Dialogs mit `layout="fixed-footer"`. */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("min-h-0 flex-1 overflow-auto px-5 py-4", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const t = useTranslations("common")
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-5 -mb-5 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-surface-2 px-5 py-4 sm:flex-row sm:justify-end group-data-[layout=fixed-footer]/dialog:m-0 group-data-[layout=fixed-footer]/dialog:flex-none group-data-[layout=fixed-footer]/dialog:px-5 group-data-[layout=fixed-footer]/dialog:py-3",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          {t('close')}
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      // K10: Schrift, Größe und Farbe stehen hier und nicht an der Aufrufstelle (Wächter no-title-override).
      className={cn("font-heading text-dialog-title text-ink", className)}
      {...props}
    />
  )
}

/**
 * Zwei Stufen, keine weiteren (K10, Designer und Joe 2026-10-07): `body`, wenn der Satz die Folge erklärt
 * (Löschen, Überschreiben, Veröffentlichen, ein einmalig sichtbares Geheimnis); sonst `meta`. Muted ist Text,
 * den man auslassen kann. Der Satz bleibt in der Description — er ist die Beschreibung, die ein Vorleser sagt.
 */
const DESCRIPTION_TONE = {
  meta: "text-meta text-muted-ink",
  body: "text-body text-ink-2",
} as const

function DialogDescription({
  className,
  tone = "meta",
  ...props
}: DialogPrimitive.Description.Props & { tone?: keyof typeof DESCRIPTION_TONE }) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        DESCRIPTION_TONE[tone],
        "*:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-ink",
        className
      )}
      {...props}
    />
  )
}

export {
  DESCRIPTION_TONE,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
