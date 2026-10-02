"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

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
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          // Farbe nicht nur im Symbol: ein Rand links in der Statusfarbe. Die
          // Statusfarben stehen zur Fläche im Kontrast ≥ 4,5:1 (`CONTRAST_PAIRS`).
          success: "border-l-4! border-l-success!",
          error: "border-l-4! border-l-error!",
          warning: "border-l-4! border-l-warning!",
          info: "border-l-4! border-l-info!",
        },
      }}
      {...props}
    />
    </div>
  )
}

export { Toaster }
