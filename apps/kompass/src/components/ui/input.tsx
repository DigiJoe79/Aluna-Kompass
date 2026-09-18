import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[var(--field-h)] w-full min-w-0 rounded-md border border-line-strong bg-field px-2.5 text-sm text-ink transition-colors",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-ink",
        "aria-invalid:border-error",
        className
      )}
      {...props}
    />
  )
}

export { Input }
