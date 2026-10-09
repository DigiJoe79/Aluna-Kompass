"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

/**
 * Der Tabellenstandard (MUSTER.md § B) steht hier und nur hier: Kopf, Zeilenhöhe
 * nach Dichte, Zebra, Hover, Linien. Aufrufstellen ergänzen Breiten und
 * Ausrichtung, nie Kopf-, Zebra-, Hover- oder Höhenklassen.
 */
const InBody = React.createContext(false)

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink [&_tr]:border-b [&_tr]:border-line",
        className
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <InBody.Provider value={true}>
      <tbody
        data-slot="table-body"
        className={cn("[&_tr:last-child]:border-0", className)}
        {...props}
      />
    </InBody.Provider>
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-surface-2 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

// Die Zeilenklassen gehören nur an Zeilen im Rumpf; `TableRow` erfährt das über den Kontext.
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  const inBody = React.useContext(InBody)
  return (
    <tr
      data-slot="table-row"
      className={cn(
        inBody &&
          "relative h-row border-b border-line-2 transition-colors even:bg-zebra hover:bg-row-hover data-[state=selected]:bg-selected",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-4 text-left align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

// Bedienelemente in der Zeile (Haken, Schalter, Knöpfe, Links) liegen über der
// Fläche des RowLink und öffnen die Zeile nicht nebenbei. RowLink/RowButton selbst
// sind ausgenommen: Ihre Fläche ist ja gerade die unterste Ebene.
const ABOVE_ROW_TARGET =
  "[&_:is(a,button,input,select,textarea,label,[role=switch],[role=checkbox],[role=menu]):not([data-row-link])]:relative [&_:is(a,button,input,select,textarea,label,[role=switch],[role=checkbox],[role=menu]):not([data-row-link])]:z-10"

/**
 * `selectable`: Die ganze Zelle liegt über der Zeilenfläche, damit Text darin
 * (IBAN, Belegnummer, Betrag) markiert und kopiert werden kann, ohne dass der
 * Klick die Zeile öffnet.
 */
function TableCell({
  className,
  selectable,
  ...props
}: React.ComponentProps<"td"> & { selectable?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-4 py-[var(--row-pad-density,0.5rem)] align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        ABOVE_ROW_TARGET,
        selectable && "relative z-10 select-text",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-ink", className)}
      {...props}
    />
  )
}

/**
 * Leere Liste in einer Tabelle mit Kopf (docs/MUSTER.md § G; K10, Designer und Joe 2026-10-06): eine Zeile
 * mit einer Zelle über alle Spalten, Text im Ton von `EmptyState`. Ohne Tabellenkopf bleibt `EmptyState`.
 */
function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-6 text-center whitespace-normal text-meta text-muted-ink">
        {children}
      </TableCell>
    </TableRow>
  )
}

/** Gruppenzeile im Rumpf (z. B. je Modul): ein Kopf über alle Spalten der Gruppe (K10 Charge 2, T3.5). */
function TableGroupRow({ colSpan, children, testId }: { colSpan: number; children: React.ReactNode; testId?: string }) {
  return (
    <TableRow data-testid={testId} className="bg-surface-2 even:bg-surface-2">
      <TableHead colSpan={colSpan} scope="colgroup" className="text-hint font-semibold text-ink-2">
        {children}
      </TableHead>
    </TableRow>
  )
}

const ROW_TARGET =
  'after:absolute after:inset-0 after:content-[""] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-focus'

/** Öffnet den Datensatz der Zeile (MUSTER.md § G): Link in Spalte 1, Fläche über die ganze Zeile. */
function RowLink({
  className,
  ...props
}: React.ComponentProps<typeof Link>) {
  return (
    <Link
      data-row-link
      draggable={false}
      className={cn(
        "font-semibold text-link underline-offset-2 hover:underline",
        ROW_TARGET,
        className
      )}
      {...props}
    />
  )
}

/** Wie RowLink, wenn die Zeile aufklappt oder ein Seitenfenster öffnet statt zu navigieren. */
function RowButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-row-link
      className={cn("text-left font-semibold text-link", ROW_TARGET, className)}
      {...props}
    />
  )
}

export {
  RowLink,
  RowButton,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableEmpty,
  TableGroupRow,
}
