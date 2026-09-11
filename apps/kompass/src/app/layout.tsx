import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './globals.css';
import { resolveActiveTheme } from '@kompass/core';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { depsReady, getDeps } from '@/lib/deps';
import { themeToCss } from '@/lib/theme-css';

/**
 * Das Layout liest das Theme aus der Datenbank und gilt für jede Seite. Ohne
 * diese Zeile rendert `next build` jede nicht selbst dynamische Seite vor, und
 * die parallelen Worker öffnen dieselbe SQLite-Datei — `database is locked`.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return { title: t('name') };
}

const PREFERENCE_BOOTSTRAP = `(function(){try{var s=localStorage.getItem('kompass.colorScheme');if(!s){s=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-color-scheme',s);var d=localStorage.getItem('kompass.density');if(d){document.documentElement.setAttribute('data-density',d)}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  await depsReady();
  const theme = resolveActiveTheme(getDeps());
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <style id="theme-tokens" dangerouslySetInnerHTML={{ __html: themeToCss(theme) }} />
        <script dangerouslySetInnerHTML={{ __html: PREFERENCE_BOOTSTRAP }} />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <NextIntlClientProvider>
          {children}
          <Toaster position="bottom-right" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
