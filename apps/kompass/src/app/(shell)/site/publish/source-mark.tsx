'use client';

import type { PublishSource } from '@kompass/module-site';
import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/status-badge';

/** Die Marke „MCP“ der Laufkarte, der Historie und des Protokolls — überall dieselbe. */
export function McpBadge() {
  const t = useTranslations('site.publish');
  return (
    <StatusBadge tone="agent" icon={Bot}>
      {t('flow.run.agentBadge')}
    </StatusBadge>
  );
}

/**
 * Wer einen Publish ausgelöst hat, wie das Änderungsprotokoll den Kanal nennt:
 * „Oberfläche“ trägt nur den Namen, MCP die Marke samt Token und Person, das
 * System (ein Neustart beendete den Lauf) einen ruhigen Text.
 */
export function SourceMark({ source, name }: { source: PublishSource; name: string | null }) {
  const t = useTranslations('site.publish');
  if (source.channel === 'mcp') {
    const who = name ?? '—';
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <McpBadge />
        {source.tokenName ? t('history.source.mcpToken', { token: source.tokenName, name: who }) : t('history.source.mcp', { name: who })}
      </span>
    );
  }
  if (source.channel === 'system') return <>{name ? t('history.source.systemFor', { name }) : t('history.source.system')}</>;
  return <>{name ?? t('history.source.unknown')}</>;
}
