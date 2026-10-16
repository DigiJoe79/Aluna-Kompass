"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Spaltenrolle (Entwurf E1 „Tabelle am Telefon“, Designer 2026-10-17; MUSTER.md § G): steht an Kopf **und** Zelle
 * einer Spalte. Unter `md` wird jede Zeile zur Kartenzeile — `title` 1. Zeile links (höchstens zwei Zeilen),
 * `status` 1. Zeile rechts, `amount` rechts (mit Status in der 2. Zeile), `meta` 2. Zeile mit „·“, höchstens drei.
 * Von `md` bis `lg` fallen die Spalten ohne Rolle weg, ab `lg` stehen alle. Zwei Plätze, die keine Spalte des
 * Bildes sind, aber stehen bleiben müssen: `select` (Auswahl-Haken links) und `actions` (Zeilenmenü bzw.
 * Zeilenknöpfe rechts); `span` für Zellen über die ganze Zeile (Leere, Gruppenkopf, aufgeklappte Details).
 * Das Bild steht als CSS in `globals.css` („Kartenzeile“); es greift nur in einer Tabelle mit `title`.
 */
export type ColumnRole = "title" | "status" | "amount" | "meta" | "select" | "actions" | "span"

type SortOption = { field: string; label: string }

type TableContextValue = {
  /** Kartenzeile aktiv: Telefon (unter `md`) und die Tabelle hat eine Titelspalte. */
  cards: boolean
  amountLabel?: string
  setAmountLabel: (label: string) => void
  sorts: SortOption[]
  registerSort: (option: SortOption) => () => void
  /** Platz über der Kartenliste, in den `SortableHead` den Sortierknopf stellt. */
  sortSlot: HTMLElement | null
}

const TableContext = React.createContext<TableContextValue | null>(null)

/** Für Bausteine der Tabelle (`SortableHead`); außerhalb einer `Table` `null`. */
export function useTableContext() {
  return React.useContext(TableContext)
}

// Grenze wie Tailwinds `md`: Darunter ist die Zeile eine Karte (E1-Notiz „Breiten“).
const CARD_QUERY = "(max-width: 767.98px)"

function subscribeCardQuery(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {}
  const query = window.matchMedia(CARD_QUERY)
  query.addEventListener?.("change", onChange)
  return () => query.removeEventListener?.("change", onChange)
}

const cardQueryMatches = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(CARD_QUERY).matches

function Table({ className, ref, children, ...props }: React.ComponentProps<"table">) {
  const own = React.useRef<HTMLTableElement | null>(null)
  // Server und erster Durchlauf: Tabelle. Das Bild schaltet das CSS sofort um; hier geht es nur um die Rollen für
  // Vorleser (`list` statt `table`), die nach der Hydration nachziehen.
  const phone = React.useSyncExternalStore(subscribeCardQuery, cardQueryMatches, () => false)
  const [hasTitle, setHasTitle] = React.useState(false)
  const [amountLabel, setAmountLabel] = React.useState<string>()
  const [sorts, setSorts] = React.useState<SortOption[]>([])
  const [sortSlot, setSortSlot] = React.useState<HTMLElement | null>(null)

  // Nach jedem neuen Inhalt: Hat die Tabelle (noch) eine Titelspalte? Gleicher Wert löst kein neues Rendern aus.
  React.useEffect(() => {
    setHasTitle(Boolean(own.current?.querySelector('[data-col="title"]')))
  }, [children])

  const registerSort = React.useCallback((option: SortOption) => {
    setSorts((all) => (all.some((o) => o.field === option.field) ? all : [...all, option]))
    return () => setSorts((all) => all.filter((o) => o.field !== option.field))
  }, [])

  const setRef = React.useCallback(
    (node: HTMLTableElement | null) => {
      own.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )

  const cards = phone && hasTitle
  const value = React.useMemo(
    () => ({ cards, amountLabel, setAmountLabel, sorts, registerSort, sortSlot }),
    [cards, amountLabel, sorts, registerSort, sortSlot]
  )

  return (
    <TableContext.Provider value={value}>
      <div
        data-slot="table-container"
        className="relative w-full overflow-x-auto"
      >
        {cards && sorts.length > 0 ? (
          <div ref={setSortSlot} data-slot="table-sort" className="flex justify-end border-b border-line-2 px-2 py-1" />
        ) : null}
        <table
          ref={setRef}
          data-slot="table"
          role={cards ? "presentation" : undefined}
          className={cn("w-full caption-bottom text-body", className)}
          {...props}
        >
          {children}
        </table>
      </div>
    </TableContext.Provider>
  )
}

/**
 * Der Tabellenstandard (MUSTER.md § B) steht hier und nur hier: Kopf, Zeilenhöhe
 * nach Dichte, Zebra, Hover, Linien. Aufrufstellen ergänzen Breiten und
 * Ausrichtung, nie Kopf-, Zebra-, Hover- oder Höhenklassen.
 */
const InBody = React.createContext(false)
const InFooter = React.createContext(false)

const useCards = () => React.useContext(TableContext)?.cards ?? false

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  const cards = useCards()
  return (
    <thead
      data-slot="table-header"
      aria-hidden={cards || undefined}
      className={cn(
        "bg-table-head text-left text-label uppercase text-muted-ink [&_tr]:border-b [&_tr]:border-line",
        className
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  const cards = useCards()
  return (
    <InBody.Provider value={true}>
      <tbody
        data-slot="table-body"
        role={cards ? "list" : undefined}
        className={cn("[&_tr:last-child]:border-0", className)}
        {...props}
      />
    </InBody.Provider>
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  const cards = useCards()
  return (
    <InFooter.Provider value={true}>
    <tfoot
      data-slot="table-footer"
      role={cards ? "none" : undefined}
      className={cn(
        "border-t bg-surface-2 [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
    </InFooter.Provider>
  )
}

// Die Zeilenklassen gehören nur an Zeilen im Rumpf; `TableRow` erfährt das über den Kontext.
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  const inBody = React.useContext(InBody)
  const inFooter = React.useContext(InFooter)
  const cards = useCards()
  return (
    <tr
      data-slot="table-row"
      role={cards ? (inBody && !inFooter ? "listitem" : "none") : undefined}
      className={cn(
        inBody &&
          "relative h-row border-b border-line-2 transition-colors even:bg-zebra hover:bg-row-hover data-[state=selected]:bg-selected",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, col, children, ...props }: React.ComponentProps<"th"> & { col?: ColumnRole }) {
  const table = React.useContext(TableContext)
  const setAmountLabel = table?.setAmountLabel
  React.useEffect(() => {
    if (col === "amount" && typeof children === "string") setAmountLabel?.(children)
  }, [col, children, setAmountLabel])
  return (
    <th
      data-slot="table-head"
      data-col={col}
      role={table?.cards ? "none" : undefined}
      className={cn(
        "h-9 px-4 text-left align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    >
      {children}
    </th>
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
  col,
  children,
  ...props
}: React.ComponentProps<"td"> & { selectable?: boolean; col?: ColumnRole }) {
  const table = React.useContext(TableContext)
  const cards = table?.cards ?? false
  return (
    <td
      data-slot="table-cell"
      data-col={col}
      role={cards ? "none" : undefined}
      className={cn(
        "px-4 py-[var(--row-pad-density,0.5rem)] align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        ABOVE_ROW_TARGET,
        selectable && "relative z-10 select-text",
        className
      )}
      {...props}
    >
      {/* Ohne Tabellenkopf fehlt dem Vorleser der Spaltenname: „Betrag −312,40 €“ (E1-Notiz „Vorleser“). */}
      {cards && col === "amount" && table?.amountLabel ? <span className="sr-only">{table.amountLabel} </span> : null}
      {children}
    </td>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-body text-muted-ink", className)}
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
      <TableCell col="span" colSpan={colSpan} className="py-6 text-center whitespace-normal text-meta text-muted-ink">
        {children}
      </TableCell>
    </TableRow>
  )
}

/** Gruppenzeile im Rumpf (z. B. je Modul): ein Kopf über alle Spalten der Gruppe (K10 Charge 2, T3.5). */
function TableGroupRow({ colSpan, children, testId }: { colSpan: number; children: React.ReactNode; testId?: string }) {
  return (
    <TableRow data-testid={testId} className="bg-surface-2 even:bg-surface-2">
      <TableHead col="span" colSpan={colSpan} scope="colgroup" className="text-hint font-semibold text-ink-2">
        {children}
      </TableHead>
    </TableRow>
  )
}

const ROW_TARGET =
  'after:absolute after:inset-0 after:content-[""] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-focus'

/** Öffnet den Datensatz der Zeile (MUSTER.md § G): Link in Spalte 1, Fläche über die ganze Zeile. Gewicht 400, nur die
 * Linkfarbe (Designer Stufe 2 Nr. 4). */
function RowLink({
  className,
  ...props
}: React.ComponentProps<typeof Link>) {
  return (
    <Link
      data-row-link
      draggable={false}
      className={cn(
        "text-link underline-offset-2 hover:underline",
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
      className={cn("text-left text-link", ROW_TARGET, className)}
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
