"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Zwei bis vier kurze, gleichrangige Optionen nebeneinander (Freigabe Designer 2026-10-08, K10 Charge 2):
 * Radio-Semantik mit Pfeiltasten, der Fokus springt mit der Auswahl. Höhe `--field-h`, damit der Umschalter
 * auf der Linie der Felder liegt, auf dem Telefon 46 px. Die gewählte Option ist `surface` mit Rahmen auf
 * `surface-2` — keine Primärfarbe als Fläche. Ab fünf Optionen oder bei langen Beschriftungen `Select`.
 * Symbole statt Text nur mit `ariaLabel` je Option.
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
}

function Segmented<T extends string>({ options, onValueChange, className, testId, ...props }: SegmentedProps<T>) {
  return (
    <RadioGroupPrimitive
      data-slot="segmented"
      data-testid={testId}
      onValueChange={(value) => onValueChange?.(value as T)}
      className={cn(
        "inline-flex h-[var(--field-h)] shrink-0 items-stretch gap-0.5 rounded-md border border-line-strong bg-surface-2 p-0.5 max-sm:h-[46px]",
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
          data-testid={option.testId}
          className="inline-flex items-center justify-center gap-1.5 rounded-[5px] border border-transparent px-3 text-meta font-semibold whitespace-nowrap text-ink-2 outline-none transition-colors hover:text-ink focus-visible:ring-3 focus-visible:ring-focus data-checked:border-line data-checked:bg-surface data-checked:text-ink data-disabled:cursor-not-allowed data-disabled:opacity-50"
        >
          {option.label}
        </RadioPrimitive.Root>
      ))}
    </RadioGroupPrimitive>
  )
}

export { Segmented }
