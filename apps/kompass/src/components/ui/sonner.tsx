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

/**
 * Fußleisten, über denen ein Toast steht: die Speicherleiste einer Seite und die Auswahlleiste. Nicht nur, solange sie
 * klebt — auch eine kurze Maske, die gar nicht scrollt, hat ihre Leiste unten am Fenster, und ein Toast mit dem
 * Vorgabeabstand läge dann auf „Speichern“ (E2E site-entries, 2026-10-22).
 */
const BOTTOM_BARS = '[data-slot="form-action-bar"][data-placement="page"], [data-slot="selection-bar"]'
/** Ab diesem Abstand zum unteren Fensterrand gilt eine Leiste als „unten“ (Vorgabeabstand von sonner + Toasthöhe). */
const NEAR_BOTTOM_PX = 96
/**
 * Abstand des Toasts nach unten (Designer 2026-10-16, Teil 3 Nr. 12): über einer Leiste am unteren Rand deren Abstand
 * vom Rand bis zu ihrer Oberkante + 16 px, sonst die Vorgabe von sonner.
 */
export function toastBottomOffset(barHeight: number): number | undefined {
  return barHeight > 0 ? Math.round(barHeight) + 16 : undefined
}
/** Wie weit die höchste Leiste am unteren Rand in das Fenster ragt; folgt DOM, Scrollen und Fenstergröße. */
function useBottomBarReach(): number {
  const [reach, setReach] = useState(0)
  useEffect(() => {
    const measure = () => {
      const height = window.innerHeight
      const reaches = Array.from(document.querySelectorAll<HTMLElement>(BOTTOM_BARS))
        .map((bar) => bar.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.top < height && height - r.bottom <= NEAR_BOTTOM_PX)
        .map((r) => height - r.top)
      setReach(Math.max(0, ...reaches))
    }
    const observer = new MutationObserver(measure)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-stuck"] })
    // Scrollen geschieht in `main`, nicht im Dokument: in der Erfassungsphase hören, damit jedes Scrollen zählt.
    document.addEventListener("scroll", measure, { capture: true, passive: true })
    window.addEventListener("resize", measure)
    measure()
    return () => {
      observer.disconnect()
      document.removeEventListener("scroll", measure, { capture: true })
      window.removeEventListener("resize", measure)
    }
  }, [])
  return reach
}
// Kein Layout-Test der Lage (Einzelstelle, Laufzeit zählt — Projektregel); `toastBottomOffset` ist geprüft.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const bottom = toastBottomOffset(useBottomBarReach())

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
