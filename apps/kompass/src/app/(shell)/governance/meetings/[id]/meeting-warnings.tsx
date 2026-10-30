'use client';

import { useTranslations } from 'next-intl';
import { Notice } from '@/components/notice';

/** Die Hinweise an der Sitzung (`MeetingView.warnings`) und an den Feststellungen, die die Oberfläche zeigt (G-25). */
export const MEETING_WARNING_KEYS = ['formNotAllowed', 'remoteNoteMissing', 'repeatWithoutRule', 'startedOtherDay', 'beforeMemberRecords', 'noticeShort', 'minuteTakerAbsent', 'findingAgainstCount', 'reasonMissing'] as const;
type MeetingWarningKey = (typeof MEETING_WARNING_KEYS)[number];
const isKnown = (w: string): w is MeetingWarningKey => (MEETING_WARNING_KEYS as readonly string[]).includes(w);

/**
 * Hinweise an der Sitzung im Hinweismuster der Beschlüsse (`Notice level="warn"`, MUSTER § Meldungen): warnen, nie
 * sperren. Seite und Mitlauf zeigen dieselben Sätze wie `meeting_get` über MCP.
 */
export function MeetingWarnings({ warnings }: { warnings: readonly string[] }) {
  const t = useTranslations('governance.meeting.warnings');
  const shown = [...new Set(warnings)].filter(isKnown);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="meeting-warnings">
      {shown.map((w) => (
        <Notice key={w} level="warn">{t(w)}</Notice>
      ))}
    </div>
  );
}
