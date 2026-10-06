"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cn } from "cn"
import { CheckIcon } from "lucide-react"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      nativeButton={true}
      render={<button type="button" />}
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line-strong transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-line-strong after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error aria-invalid:ring-3 aria-invalid:ring-error-bg aria-invalid:aria-checked:border-brand dark:bg-field dark:aria-invalid:border-error dark:aria-invalid:ring-error-bg data-checked:border-brand data-checked:bg-brand data-checked:text-on-brand group-has-[:focus-visible]/field-label:data-checked:border-brand dark:data-checked:bg-brand",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
