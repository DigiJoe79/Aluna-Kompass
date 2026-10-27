"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { cn } from "@/lib/utils"

/**
 * Zwei bis vier kurze, gleichrangige Optionen nebeneinander (Freigabe Designer 2026-10-08, K10 Charge 2):
 * Radio-Semantik mit Pfeiltasten, der Fokus springt mit der Auswahl. Höhe `--field-h`, damit der Umschalter
 * auf der Linie der Felder liegt, auf dem Telefon 46 px. Die gewählte Option ist `surface` mit Rahmen auf
 * `surface-2` — keine Primärfarbe als Fläche. Ab fünf Optionen oder bei langen Beschriftungen `Select`.
 * Symbole statt Text nur mit `ariaLabel` je Option; er steht dann auch als `title` da.
 *
 * Schmaler als sein Inhalt (Designer Runde 8, 17c): Der Baustein misst selbst, ob die Leiste in die Breite passt. Passt
 * sie nicht, stehen die Segmente untereinander in voller Breite, je 44 px hoch, linksbündig, das gewählte mit Fläche.
 * Er scrollt und schneidet nie ab, und kein Segment bricht in sich um (zweizeilig sähe es aus wie zwei Wahlen).
 * Passt sie, ändert sich nichts.
 */
export type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
  ariaLabel?: string
  testId?: string
  disabled?: boolean
}

type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[]
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
  name?: string
  disabled?: boolean
  className?: string
  testId?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
}

// `w-fit`: so breit wie der Inhalt, auch in einer Spalte, die ihre Kinder streckt (Designer Runde 7, 259/282/283).
// `max-w-full` und `overflow-hidden` nur, damit sich ein Überlauf messen lässt: Er hält nie an, weil der Baustein dann
// untereinander stellt (17c).
function Segmented<T extends string>({ options, onValueChange, className, testId, ...props }: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const stacked = useStacked(ref)
  return (
    <RadioGroupPrimitive
      ref={ref}
      data-slot="segmented"
      data-testid={testId}
      data-stacked={stacked || undefined}
      aria-orientation={stacked ? "vertical" : "horizontal"}
      onValueChange={(value) => onValueChange?.(value as T)}
      className={cn(
        stacked
          ? "flex w-full flex-col items-stretch gap-0.5 rounded-md border border-line-strong bg-surface-2 p-0.5"
          : "inline-flex h-[var(--field-h)] w-fit max-w-full shrink-0 items-stretch gap-0.5 overflow-hidden rounded-md border border-line-strong bg-surface-2 p-0.5 max-sm:h-[46px]",
        className
      )}
      {...props}
    >
      {options.map((option) => (
        <RadioPrimitive.Root
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          aria-label={option.ariaLabel}
          // Ein Symbol ohne Text nennt seinen Namen auch Sehenden beim Verweilen (10 B27).
          title={typeof option.label === "string" ? undefined : option.ariaLabel}
          data-testid={option.testId}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[5px] border border-transparent px-3 text-meta whitespace-nowrap text-ink-2 outline-none transition-colors hover:text-ink focus-visible:ring-3 focus-visible:ring-focus data-checked:border-line data-checked:bg-surface data-checked:text-ink data-disabled:cursor-not-allowed data-disabled:opacity-50",
            stacked ? "h-11 justify-start" : "justify-center"
          )}
        >
          {option.label}
        </RadioPrimitive.Root>
      ))}
    </RadioGroupPrimitive>
  )
}

/**
 * Passt die Leiste nebeneinander? Nebeneinander zeigt ein Überlauf (`scrollWidth > clientWidth`), dass sie zu breit ist;
 * die nötige Breite wird dann gemerkt. Untereinander nimmt die Leiste die volle Breite (`clientWidth`), und sie kehrt
 * zurück, sobald die gemerkte Breite hineinpasst. Ohne `ResizeObserver` (Server, alte Browser) bleibt sie nebeneinander.
 */
function useStacked(ref: RefObject<HTMLDivElement | null>) {
  const [stacked, setStacked] = useState(false)
  const needed = useRef(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    const measure = () => {
      if (el.dataset.stacked === undefined) {
        if (el.scrollWidth > el.clientWidth + 1) {
          needed.current = el.scrollWidth
          setStacked(true)
        }
      } else if (needed.current > 0 && el.clientWidth >= needed.current) {
        setStacked(false)
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, stacked])
  return stacked
}

export { Segmented }
