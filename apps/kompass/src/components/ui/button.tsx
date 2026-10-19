import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Gesperrt ist die Fläche der eigenen Stufe, gedämpft (`opacity-50`) und ohne Hover (`pointer-events-none`) — ein
// gesperrter Primärknopf bleibt als Primärknopf erkennbar (Designer Stufe 2 Nr. 3); dunkel hat er eigene Werte (unten). Den Grund der Sperre nennt die
// Aufrufstelle als Text neben dem Knopf, nicht nur im Tooltip. Es gibt eine sekundäre Stufe, `outline`; das grau
// gefüllte `secondary` ist entfallen (Designer Runde 3, Teil 1 Nr. 1, 044).
const variants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-[length:var(--field-font)] font-semibold whitespace-nowrap transition-all select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-error [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Dunkel ist der gesperrte Primärknopf nicht gedämpftes Petrol (das las sich als halbdurchsichtig), sondern ohne
        // Deckkraft die Sperrfläche `disabled-bg` mit Schrift `disabled-ink` und Rand `line-strong` (Runde 3, Punkt 7;
        // Runde 4 Nachtrag, 215/216). Der dunkle Selektor wiegt schwerer als `disabled:opacity-50` der Grundklasse.
        // Hell bleibt er, wie er ist.
        default:
          "bg-brand text-on-brand hover:bg-brand-ink [:root[data-color-scheme=dark]_&]:disabled:border-line-strong [:root[data-color-scheme=dark]_&]:disabled:bg-disabled [:root[data-color-scheme=dark]_&]:disabled:text-disabled-ink [:root[data-color-scheme=dark]_&]:disabled:opacity-100",
        outline:
          "border-line-strong bg-surface hover:bg-hover aria-expanded:bg-hover",
        ghost:
          "hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink",
        // Gefahr in voller Fläche; die Schrift in Flächenfarbe hält 4,5:1 (Paar color-error/surface, Designer Stufe 2
        // Nr. 3). Ablehnen (Auslage, Vorschlag) ist keine Gefahr und bleibt neutral.
        destructive:
          "bg-error text-surface hover:bg-[color-mix(in_oklch,var(--color-error),var(--ink)_14%)]",
        link: "text-link underline-offset-4 hover:underline hover:text-link-hover",
      },
      size: {
        default:
          "h-[var(--field-h)] gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-hint [&_svg:not([class*='size-'])]:size-3",
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

/**
 * Zusammengeführt wie in `Button`: Ein Link mit `className={buttonVariants(…)}` bekam sonst `border-transparent` der
 * Grundklasse und die Randfarbe der Stufe zugleich, und das Stylesheet entschied für transparent (Runde 3, 019).
 */
function buttonVariants(props?: Parameters<typeof variants>[0]): string {
  return cn(variants(props))
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof variants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
