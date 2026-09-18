"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * `required` macht sichtbar, was das Feld ohnehin verlangt. Das Sternchen steht
 * **neben** dem Label, nicht darin: Im Label gelesen hiesse das Feld „Betreff*“
 * — Chromium nimmt den Text auch dann in den zugänglichen Namen, wenn er
 * `aria-hidden` trägt.
 */
function Label({
  className,
  required,
  ...props
}: React.ComponentProps<"label"> & { required?: boolean }) {
  const label = (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-1.5 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )

  if (!required) return label

  return (
    <span data-slot="label-required" className="flex items-center gap-1.5">
      {label}
      <span aria-hidden="true" className="font-bold text-brand-accent">
        *
      </span>
    </span>
  )
}

export { Label }
