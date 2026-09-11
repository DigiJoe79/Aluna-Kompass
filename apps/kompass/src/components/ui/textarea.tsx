import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-[calc(var(--field-h)*2)] w-full rounded-md border border-line-strong bg-field px-2.5 py-2 text-sm text-ink transition-colors",
        "disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-ink",
        "aria-invalid:border-error",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
