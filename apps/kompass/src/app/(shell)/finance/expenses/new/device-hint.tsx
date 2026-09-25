'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Device } from '@/lib/finance/expenses';

function Steps({ device }: { device: 'ios' | 'android' }) {
  const t = useTranslations('finance.expenses.new.guide');
  return (
    <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
      <li>{t(`${device}.step1`)}</li>
      <li>{t(`${device}.step2`)}</li>
      <li>{t(`${device}.step3`)}</li>
    </ol>
  );
}

/**
 * Kurzanleitung unter dem PDF-Feld (Designer-README 3a): drei Schritte
 * passend zum Gerät, das der User-Agent verrät — ist es nicht erkennbar,
 * stehen beide als Reiter. Kein Kamera-Knopf: Aus einem Foto wird hier nie
 * ein PDF (Nordstern).
 */
export function DeviceHint({ device }: { device: Device }) {
  const t = useTranslations('finance.expenses.new.guide');
  return (
    <div data-testid="scan-guide" className="space-y-2 rounded-md bg-surface-2 p-3">
      <p className="text-[12px] font-semibold text-ink">{t('title')}</p>
      {device ? (
        <Steps device={device} />
      ) : (
        <Tabs defaultValue="ios">
          <TabsList>
            <TabsTrigger value="ios">{t('ios.tab')}</TabsTrigger>
            <TabsTrigger value="android">{t('android.tab')}</TabsTrigger>
          </TabsList>
          <TabsContent value="ios">
            <Steps device="ios" />
          </TabsContent>
          <TabsContent value="android">
            <Steps device="android" />
          </TabsContent>
        </Tabs>
      )}
      <Link href="/help/finanzen/auslagen" className="text-[12px] text-ink underline underline-offset-2">
        {t('more')}
      </Link>
    </div>
  );
}
