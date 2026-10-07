"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { cn } from "@/lib/utils"

/**
 * Zwei bis vier kurze Optionen, wo `ChoiceCards` zu schwer wäre (Freigabe Joe 05.10.2026, HANDOFF Konsistenz
 * § 8c). Native Radios fallen im Dunkelmodus aus dem Bild; hier zeichnet der Baustein den Kreis selbst, nur mit
 * Theme-Tokens, wie `Checkbox`. Jede Option steht in einem `<label>` mit ihrem Text:
 *
 *   <RadioGroup aria-label="Art" value={kind} onValueChange={setKind}>
 *     <label className="flex items-center gap-2"><RadioGroupItem value="person" />Person</label>
 *   </RadioGroup>
 */
function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return <RadioGroupPrimitive data-slot="radio-group" className={cn("flex flex-col gap-2", className)} {...props} />
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-error dark:bg-field data-checked:border-brand",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="size-2 rounded-full bg-brand" />
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupItem }
