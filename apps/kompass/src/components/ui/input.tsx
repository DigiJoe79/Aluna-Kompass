import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

// Feldschrift aus `--field-font` (MUSTER, Schrift) — einmal, für das Feld mit und ohne Einheit.
const FIELD_TEXT = "text-[length:var(--field-font)] text-ink"
const FIELD = cn("h-[var(--field-h)] w-full min-w-0 rounded-md border border-line-strong bg-field px-2.5 transition-colors", FIELD_TEXT)

/**
 * `unit` (Designer Runde 3: 065, 085, 121, 124, 125, 172, 181, 182): Die Einheit („€“, „Monate“, „Tage“) steht rechts im
 * selben Rahmen wie beim Betragsfeld (`finance/amount-field.tsx`), nicht als loser Text daneben. `className` gilt dann
 * dem Rahmen (Breite), nicht dem Eingabefeld.
 */
function Input({ className, type, unit, ...props }: React.ComponentProps<"input"> & { unit?: string }) {
  if (unit) {
    return (
      <span
        data-slot="input-unit"
        className={cn(
          // Der Fokusring steht am Rahmen, wie sonst am Feld (`:focus-visible` in globals.css).
          "flex h-[var(--field-h)] w-full min-w-0 items-stretch overflow-hidden rounded-md border border-line-strong bg-field transition-colors has-[[aria-invalid=true]]:border-error has-disabled:bg-disabled has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus",
          className
        )}
      >
        <InputPrimitive
          type={type}
          data-slot="input"
          className={cn("w-full min-w-0 flex-1 bg-transparent px-2.5 outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-disabled-ink", FIELD_TEXT)}
          {...props}
        />
        <span className="flex items-center border-l border-line bg-surface-2 px-2.5 text-meta text-muted-ink">{unit}</span>
      </span>
    )
  }
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        FIELD,
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-body file:text-ink",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-ink",
        "aria-invalid:border-error",
        className
      )}
      {...props}
    />
  )
}

export { Input }
