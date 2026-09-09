'use client';

import { useCallback, useEffect, useState } from 'react';

type Prefs = {
  sidebarCollapsed: boolean;
  colorScheme: 'light' | 'dark';
  density: 'compact' | 'default' | 'comfortable';
  mediaView: 'list' | 'grid';
  navCollapsedGroups: string[];
};
const DEFAULTS: Prefs = {
  sidebarCollapsed: false,
  colorScheme: 'light',
  density: 'default',
  mediaView: 'list',
  navCollapsedGroups: [],
};

function read<K extends keyof Prefs>(key: K): Prefs[K] {
  try {
    const raw = localStorage.getItem(`kompass.${key}`);
    return raw === null ? DEFAULTS[key] : (JSON.parse(raw) as Prefs[K]);
  } catch {
    return DEFAULTS[key];
  }
}

function apply<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  if (key === 'colorScheme') document.documentElement.setAttribute('data-color-scheme', String(value));
  if (key === 'density') document.documentElement.setAttribute('data-density', String(value));
}

export function usePreference<K extends keyof Prefs>(key: K): [Prefs[K], (value: Prefs[K]) => void] {
  const [value, setValue] = useState<Prefs[K]>(DEFAULTS[key]);
  useEffect(() => {
    if (key === 'colorScheme') {
      const attr = document.documentElement.getAttribute('data-color-scheme');
      setValue((attr === 'dark' ? 'dark' : 'light') as Prefs[K]);
      return;
    }
    setValue(read(key));
  }, [key]);
  const update = useCallback(
    (next: Prefs[K]) => {
      setValue(next);
      try {
        localStorage.setItem(`kompass.${key}`, JSON.stringify(next));
      } catch {
        /* privater Modus: Präferenz gilt nur für diese Sitzung */
      }
      apply(key, next);
    },
    [key],
  );
  return [value, update];
}
