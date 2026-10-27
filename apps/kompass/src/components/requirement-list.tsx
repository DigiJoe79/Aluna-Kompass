import { Check, Circle, CircleDashed } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Notice, type NoticeReason } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { Disclosure } from '@/components/ui/disclosure';
import { groupOpenFirst, type RequirementGroup } from '@/lib/requirement-groups';
import { buttonVariants } from '@/components/ui/button';
import { Overline } from '@/components/overline';
import { cn } from '@/lib/utils';

export interface RequirementListItem {
  key: string;
  title: string;
  /** Erledigt bleibt sichtbar — nicht ausgeblendet, nur ruhiger dargestellt. */
  done: boolean;
  /** Wartet auf eine Abhängigkeit; `blockedText` sagt, worauf. Mit `grouping`: sperrt. */
  blocked: boolean;
  blockedText?: string;
  /** Ein Schritt, ohne den es auch geht: Marke (`label`, „Optional“) neben dem Titel, `note` als Unterzeile (11-1 B33). */
  optional?: { label: string; note: string };
  /** Zusatzangabe, z. B. „2 Konten, 1 ohne Anfangsbestand“. */
  detail?: string;
  /** Der Betrachter kann den Schritt selbst erledigen. */
  canSelf: boolean;
  /** Namen derer, die es erledigen können, wenn der Betrachter es nicht selbst kann. */
  canDoNames: string[];
  canDoText: string;
  /** Ohne Ziel (`null`) steht nur der Text — etwa solange die Seite des Schritts noch fehlt. */
  href: string | null;
  actionLabel: string;
  doneLabel: string;
  /** Zusätzliche Aktion neben dem Sprung-Knopf, z. B. „Vorgaben übernehmen“. */
  extra?: ReactNode;
  /** Dritter Zustand (nur mit `grouping`): `false` — die Zeile trifft hier nicht zu und steht unter „Trifft nicht zu“. */
  applies?: boolean;
  /** Nur mit `grouping`: ein Hinweis, der nie sperrt — steht als Warnkasten unter „Bitte ansehen“, auf Wunsch mit Pflichtbegründung. */
  warning?: { text: string; reason?: NoticeReason };
}

/**
 * Generische Einrichtungs-Checkliste (H1, `components/`): erledigte Zeilen
 * bleiben stehen, offene liegen auf `bg-surface-2`, blockierte nennen ihre
 * Abhängigkeit, und wer den Schritt nicht selbst erledigen kann, liest, wer es
 * kann. Kein Finanzwort im Baustein selbst — die Beschriftung kommt vom Aufrufer.
 *
 * Eine offene Zeile mit eigenem Knopf trägt ein Symbol statt eines Badges: Das
 * Wort steht einmal, auf dem Knopf (N3, C1-3/E-4). Eine erledigte trägt den Haken und
 * einen gedämpften Titel (Runde 3, 166).
 *
 * `grouping="open-first"` (N3, C1-2): vier Gruppen nach `groupOpenFirst` —
 * „Fehlt noch“ voll, „Bitte ansehen“ als Warnkästen, „Erfüllt · n“ und
 * „Trifft nicht zu · n“ eingeklappt. Leere Gruppen fehlen.
 */
export function RequirementList({ items, grouping, variant }: { items: RequirementListItem[]; grouping?: 'open-first'; variant?: 'compact' | 'rows' }) {
  if (grouping === 'open-first') return <GroupedRequirementList items={items} />;
  if (variant === 'compact') return <CompactRequirementList items={items} />;
  if (variant === 'rows') return <RowsRequirementList items={items} />;
  return (
    <ul className="space-y-2" data-testid="requirement-list">
      {items.map((item) => (
        <OpenRow key={item.key} item={item} />
      ))}
    </ul>
  );
}

function OpenRow({ item, symbolOnly = false }: { item: RequirementListItem; symbolOnly?: boolean }) {
  const t = useTranslations('common.requirements');
  const ownAction = !item.done && !item.blocked && item.canSelf;
  const symbol = symbolOnly ? !item.done : ownAction;
  return (
    <li
      data-testid={`requirement-${item.key}`}
      data-done={item.done}
      data-blocked={item.blocked}
      // 09 B11: Keine graue Fläche je Zeile — im Dialog stapelten sich sonst drei Grauflächen-Ebenen (gilt auch für
      // Verzicht und Partner). Offen sagt das Zeichen bzw. die Marke.
      // `relative`: Die Zeile ist Bezugsrahmen ihres `sr-only` (absolut). Ohne ihn hing es am Fenster statt am scrollenden
      // `main` und verlängerte unter dem Falz das Dokument — leere Fläche unter der Finanz-Checkliste (Joe 2026-10-19).
      // Kein Layout-E2E für die Stelle (MUSTER), Komponententest in `tests/requirement-list.test.tsx`.
      className="relative flex flex-col gap-2 rounded-md border border-line bg-surface p-3.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          {/* Runde 3, 166: Erledigt und offen haben je ein Symbol (Haken, Kreis), das Wort steht für Vorleser. */}
          {item.done ? (
            <>
              <Check className="size-4 shrink-0 text-success" aria-hidden />
              <span className="sr-only">{item.doneLabel}</span>
            </>
          ) : symbol ? (
            <>
              <CircleDashed className="size-4 shrink-0 text-warning" aria-hidden />
              <span className="sr-only">{t('open')}</span>
            </>
          ) : (
            <StatusBadge tone={item.blocked ? 'neutral' : 'warning'}>{item.blocked ? item.blockedText : item.actionLabel}</StatusBadge>
          )}
          <span className={item.done ? 'font-semibold text-muted-ink' : 'font-semibold text-ink'}>{item.title}</span>
          {item.optional ? <StatusBadge tone="neutral">{item.optional.label}</StatusBadge> : null}
        </div>
        {item.optional ? <p className="text-meta text-muted-ink">{item.optional.note}</p> : null}
        {item.detail ? <p className="text-meta text-muted-ink">{item.detail}</p> : null}
        {!item.done && !item.blocked && !item.canSelf && item.canDoNames.length > 0 ? (
          <p className="text-hint text-muted-ink" data-testid={`requirement-${item.key}-candoo`}>
            {item.canDoText}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.extra}
        {!item.done && (symbolOnly || !item.blocked) && item.canSelf && item.href ? <ActionLink item={{ ...item, href: item.href }} /> : null}
      </div>
    </li>
  );
}

/**
 * `variant="compact"` — N1, Freigabe Joe 2026-10-22, CSV-Assistent Schritt 3 („Pflicht“): eine Zeile je Punkt ohne
 * Rahmen und ohne Fläche, Symbol (Haken bzw. Kreis wie MUSTER § F), Titel, daneben `detail` (die zugeordnete Spalte oder
 * „fehlt“). Kein Knopf und keine Gruppen: `href`, `canSelf` und `extra` gelten hier nicht.
 */
function CompactRequirementList({ items }: { items: RequirementListItem[] }) {
  const t = useTranslations('common.requirements');
  return (
    <ul className="space-y-1.5" data-testid="requirement-list">
      {items.map((item) => (
        // `relative`: Bezugsrahmen des `sr-only` wie in `OpenRow`.
        <li key={item.key} data-testid={`requirement-${item.key}`} data-done={item.done} className="relative flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          {item.done ? (
            <>
              <Check className="size-4 shrink-0 self-center text-success" aria-hidden />
              <span className="sr-only">{item.doneLabel}</span>
            </>
          ) : (
            <>
              <CircleDashed className="size-4 shrink-0 self-center text-warning" aria-hidden />
              <span className="sr-only">{t('open')}</span>
            </>
          )}
          <span className={item.done ? 'font-semibold text-muted-ink' : 'font-semibold text-ink'}>{item.title}</span>
          {item.detail ? <span className={item.done ? 'text-meta text-ink-2' : 'text-meta text-warning'}>{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * `variant="rows"` — Freigabe Joe 2026-10-26, Designer Runde 7 16b/16d (Board Umsatzsteuer 8a/8b): Zeilen mit
 * Trennlinie (`line-2`) in der Karte des Aufrufers statt Karten in der Karte — Dokumente der Abgabe, Beilagen. Je Zeile
 * Symbol (Haken bzw. Kreis wie MUSTER § F), Titel in normalem Gewicht, `detail` mit „·“ dahinter, rechts `extra` bzw.
 * der Sprung-Knopf. Wartend (`blocked`) ist die ganze Zeile gedämpft, rechts steht `blockedText` und kein Knopf — auch
 * wenn der Aufrufer `extra` mitgibt (16b: „Ablegen gibt es erst nach dem Festschreiben“). `optional` gilt hier nicht.
 *
 * Erledigt steht **voll** (Designer Runde 8, 17a): Haken in `success`, Titel in `ink`, `detail` (das Datum) in `muted`,
 * rechts die Nummer als Link. In dieser Variante heißt gedämpft schon „noch nicht möglich“; gedämpft erledigt sähe aus
 * wie wartend. Die Regel „erledigt = gedämpft“ gilt weiter für die Karten-Variante (MUSTER § F).
 */
function RowsRequirementList({ items }: { items: RequirementListItem[] }) {
  const t = useTranslations('common.requirements');
  return (
    <ul className="border-t border-line-2" data-testid="requirement-list">
      {items.map((item) => {
        const action = !item.done && !item.blocked && item.canSelf && item.href ? <ActionLink item={{ ...item, href: item.href }} /> : null;
        // Gedämpft ist nur, was noch nicht möglich ist (17a); erledigt steht voll.
        const muted = item.blocked && !item.done;
        return (
          <li
            key={item.key}
            data-testid={`requirement-${item.key}`}
            data-done={item.done}
            data-blocked={item.blocked}
            data-muted={muted || undefined}
            // `relative`: Bezugsrahmen des `sr-only` wie in `OpenRow`. Am Telefon bricht die rechte Seite unter den Titel.
            className={cn('relative flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line-2 py-2.5 last:border-b-0', muted && 'text-muted-ink')}
          >
            {item.done ? (
              <>
                <Check className="size-4 shrink-0 text-success" aria-hidden />
                <span className="sr-only">{item.doneLabel}</span>
              </>
            ) : (
              <>
                {/* 17a: offen ein leerer Kreis, noch nicht möglich gestrichelt. Der Kreis steht in `muted` statt im Rahmenton
                    des Boards (`line-strong`), weil ein Zustandszeichen 3:1 zur Fläche braucht. */}
                {item.blocked ? <CircleDashed className="size-4 shrink-0 text-muted-ink" aria-hidden /> : <Circle className="size-4 shrink-0 text-muted-ink" aria-hidden />}
                <span className="sr-only">{t('open')}</span>
              </>
            )}
            <span className="min-w-0 flex-1">
              <span className={muted ? 'text-muted-ink' : 'text-ink'}>{item.title}</span>
              {item.detail ? <span className="text-muted-ink"> · {item.detail}</span> : null}
              {!item.done && !item.blocked && !item.canSelf && item.canDoNames.length > 0 ? (
                <span className="block text-hint text-muted-ink" data-testid={`requirement-${item.key}-candoo`}>
                  {item.canDoText}
                </span>
              ) : null}
            </span>
            {item.blocked ? (
              item.blockedText ? <span className="text-meta">{item.blockedText}</span> : null
            ) : item.extra || action ? (
              <span className="flex shrink-0 flex-wrap items-center gap-2">
                {item.extra}
                {action}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ActionLink({ item }: { item: RequirementListItem & { href: string } }) {
  return (
    <Link href={item.href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      {item.actionLabel}
    </Link>
  );
}

function GroupedRequirementList({ items }: { items: RequirementListItem[] }) {
  const t = useTranslations('common.requirements');
  const label = (group: RequirementGroup) => t(`groups.${group}`);
  return (
    <div className="space-y-3" data-testid="requirement-list">
      {groupOpenFirst(items).map(({ group, items: rows }) => {
        if (group === 'missing') {
          return (
            <section key={group} aria-label={label(group)} data-testid="requirement-group-missing" className="space-y-2">
              <Overline>{label(group)}</Overline>
              <ul className="space-y-2">
                {rows.map((item) => (
                  <OpenRow key={item.key} item={item} symbolOnly />
                ))}
              </ul>
            </section>
          );
        }
        if (group === 'review') {
          return (
            <section key={group} aria-label={label(group)} data-testid="requirement-group-review" className="space-y-2">
              <Overline>{label(group)}</Overline>
              {rows.map((item) => {
                // Sperrt die Zeile außerdem, steht ihre Abhilfe schon unter „Fehlt noch“ — hier nicht noch einmal.
                const action = !item.done && !item.blocked && item.canSelf && item.href ? <ActionLink item={{ ...item, href: item.href }} /> : undefined;
                return (
                  <div key={item.key} data-testid={`requirement-review-${item.key}`}>
                    <Notice level="warn" title={item.title} reason={item.warning?.reason} action={action}>
                      {item.warning?.text}
                    </Notice>
                  </div>
                );
              })}
            </section>
          );
        }
        return (
          <Disclosure key={group} label={label(group)} count={rows.length} tone={group === 'done' ? 'success' : 'neutral'} bounded={false}>
            <ul className="space-y-1" data-testid={`requirement-group-${group}`}>
              {rows.map((item) => (
                <li key={item.key} data-testid={`requirement-${item.key}`} data-done={item.done} data-blocked={item.blocked} data-applies={group !== 'notApplicable'} className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-meta">
                  {group === 'done' ? <Check className="size-3.5 shrink-0 self-center text-success" aria-label={item.doneLabel} /> : null}
                  <span className={group === 'done' ? 'text-ink' : 'text-muted-ink'}>{item.title}</span>
                  {group === 'done' && item.detail ? <span className="text-muted-ink">· {item.detail}</span> : null}
                </li>
              ))}
            </ul>
          </Disclosure>
        );
      })}
    </div>
  );
}
