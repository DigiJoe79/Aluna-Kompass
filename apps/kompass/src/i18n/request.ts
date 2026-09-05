import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => ({
  locale: 'de',
  timeZone: 'Europe/Berlin',
  messages: (await import('../../messages/de.json')).default,
}));
