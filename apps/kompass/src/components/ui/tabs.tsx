"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Base UI schreibt selbst `data-orientation="horizontal"|"vertical"` an die
 * Wurzel — die Klassen hier beziehen sich deshalb darauf und nicht auf ein
 * `data-horizontal`, das im DOM nie stand. Und `orientation` geht an die
 * Primitive, sonst richtet sich zwar das Aussehen, aber nicht die
 * Tastaturbedienung.
 */
function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-ink group-data-[orientation=horizontal]/tabs:h-8 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-surface-2",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-ink-2 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-ink focus-visible:border-focus focus-visible:ring-[3px] focus-visible:ring-focus focus-visible:outline-1 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-ink dark:hover:text-ink group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-surface data-active:text-ink dark:data-active:border-line-strong dark:data-active:bg-line-strong dark:data-active:text-ink",
        "after:absolute after:bg-ink after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none data-[hidden]:hidden", className)}
      {...props}
    />
  )
}

/**
 * Reiterleiste im Aussehen von `PanelNav` (Unterstrich in der Themefarbe, über die volle Breite):
 * die vorhandene Variante `line` mit diesen Klassen an Leiste und Reitern. Für Reiter, die nicht
 * die Adresse wechseln (Tiere, Geräte-Hinweis); die Leiste ergänzt ihren Einzug selbst.
 */
const lineTabsListClass = "h-auto w-full justify-start gap-5 rounded-none border-b border-line p-0"
const lineTabsTriggerClass =
  "h-9 flex-none gap-2 rounded-none border-0 px-0 text-[14px] data-active:font-semibold group-data-[orientation=horizontal]/tabs:after:bottom-0 after:bg-brand"

export { lineTabsListClass, lineTabsTriggerClass, Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
