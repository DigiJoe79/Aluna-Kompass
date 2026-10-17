"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Töne wie `Notice` (Designer 2026-10-16, Teil 3 Nr. 11): Vollrahmen und Fläche in der Statusfarbe. Keine Info-Variante
 * — Info ist neutral und trägt die gewöhnliche Fläche (`--normal-*`), Blau gibt es nicht (MUSTER § A). Die
 * Statusfarben stehen zur Fläche im Kontrast ≥ 4,5:1 (`CONTRAST_PAIRS`).
 */
export const TOAST_CLASSES = {
  success: "border-success! bg-success-bg!",
  warning: "border-warning! bg-warning-bg!",
  error: "border-error! bg-error-bg!",
} as const

/** Klebende Fußleisten, über denen ein Toast steht: die Speicherleiste, solange sie klebt, und die Auswahlleiste. */
const STICKY_BARS = '[data-slot="form-action-bar"][data-stuck], [data-slot="selection-bar"]'

/**
 * Abstand des Toasts nach unten (Designer 2026-10-16, Teil 3 Nr. 12): über einer klebenden Leiste Leistenhöhe + 16 px,
 * sonst die Vorgabe von sonner.
 */
export function toastBottomOffset(barHeight: number): number | undefined {
  return barHeight > 0 ? Math.round(barHeight) + 16 : undefined
}

/** Höhe der höchsten klebenden Leiste; folgt dem DOM, weil die Speicherleiste erst beim Scrollen klebt. */
function useStickyBarHeight(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const measure = () => {
      const bars = Array.from(document.querySelectorAll<HTMLElement>(STICKY_BARS))
      setHeight(Math.max(0, ...bars.map((bar) => bar.getBoundingClientRect().height)))
    }
    const observer = new MutationObserver(measure)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-stuck"] })
    measure()
    return () => observer.disconnect()
  }, [])
  return height
}

// Kein Layout-Test der Lage (Einzelstelle, Laufzeit zählt — Projektregel); `toastBottomOffset` ist geprüft.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const bottom = toastBottomOffset(useStickyBarHeight())

  return (
    <div role="status">
      <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          // Theme-Tokens statt shadcn-Namen: `--popover`/`--border`/`--radius`
          // gibt es nur als `--color-*` im @theme, nicht als Laufzeitvariable
          // (HANDOFF Ordnerbaum § 3.8).
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--line)",
          "--border-radius": "var(--radius-md)",
        } as React.CSSProperties
      }
      offset={bottom === undefined ? undefined : { bottom }}
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          ...TOAST_CLASSES,
        },
      }}
      {...props}
    />
    </div>
  )
}

export { Toaster }
