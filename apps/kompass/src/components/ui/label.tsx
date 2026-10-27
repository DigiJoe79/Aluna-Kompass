"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

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
        "flex items-center gap-1.5 text-meta font-semibold select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
        // Mit Stern fließt das Label als Text: Bricht es um, steht der Stern direkt hinter dem letzten Wort, nicht
        // rechts außen neben einem Block (Designer Runde 7, 316/15e).
        required && "inline"
      )}
      {...props}
    />
  )

  if (!required) return label

  return (
    <span data-slot="label-required" className="block">
      {label}
      {/* 600 wie das Label (Designer § 14.2): Der Stern ist Geschwister, erbt also nicht. Pflicht für Vorleser: aria-required am Feld. */}
      <span aria-hidden="true" className="ml-1.5 font-semibold text-brand-accent">
        *
      </span>
    </span>
  )
}

export { Label }
