import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-[length:var(--field-font)] font-semibold whitespace-nowrap transition-all select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-ink aria-invalid:border-error [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-brand text-on-brand hover:bg-brand-ink",
        outline:
          "border-line-strong bg-surface hover:bg-hover aria-expanded:bg-hover",
        secondary:
          "bg-surface-2 text-ink-2 hover:bg-hover aria-expanded:bg-hover",
        // Gesperrt ohne Fläche: Ein ghost-Knopf hat keine, die graue Fläche aus der Basis hob ihn hervor statt ihn
        // auszugrauen (gesperrter Blätterpfeil „7 von 7“, Befund 10). Kein Layout-Test — Einzelstelle, Laufzeit zählt.
        ghost:
          "hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink disabled:bg-transparent",
        destructive:
          "bg-error-bg text-error hover:bg-[color-mix(in_oklch,var(--color-error-bg),var(--color-error)_12%)]",
        link: "text-link underline-offset-4 hover:underline hover:text-link-hover",
      },
      size: {
        default:
          "h-[var(--field-h)] gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-sm px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-[calc(var(--field-h)+4px)] gap-1.5 px-4",
        icon: "size-[var(--field-h)]",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-sm",
        "icon-lg": "size-[calc(var(--field-h)+4px)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
