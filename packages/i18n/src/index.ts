/**
 * @muster/i18n — i18next initialisation
 *
 * Import `i18n` (the configured instance) in your app entry point and call
 * `initI18n()` once before rendering the UI.
 *
 * Usage in components:
 *   import { useTranslation } from 'react-i18next';
 *   const { t } = useTranslation();
 *   t('auth.login') // → "Log in"
 */

import i18n from 'i18next';

import enTranslation from './locales/en/translation.json' assert { type: 'json' };
import ptTranslation from './locales/pt/translation.json' assert { type: 'json' };

export type SupportedLocale = 'en' | 'pt';

export const SUPPORTED_LOCALES: Record<SupportedLocale, string> = {
  en: 'English',
  pt: 'Português',
};

export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Initialise i18next with all bundled locale resources.
 * Call this once at app startup before rendering any UI.
 *
 * @param locale - Optional locale override. Defaults to the browser language
 *                 if supported, otherwise falls back to English.
 */
export async function initI18n(locale?: SupportedLocale): Promise<void> {
  const detectedLocale =
    locale ??
    (navigator.language.slice(0, 2) as SupportedLocale in SUPPORTED_LOCALES
      ? (navigator.language.slice(0, 2) as SupportedLocale)
      : DEFAULT_LOCALE);

  await i18n.init({
    lng: detectedLocale,
    fallbackLng: DEFAULT_LOCALE,
    debug: process.env['NODE_ENV'] === 'development',
    interpolation: {
      // React already escapes values — no need for i18next to do it again
      escapeValue: false,
    },
    resources: {
      en: { translation: enTranslation },
      pt: { translation: ptTranslation },
    },
  });
}

/**
 * Change the active locale at runtime.
 * The UI will re-render automatically if you're using react-i18next.
 */
export async function setLocale(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
}

export { i18n };
export default i18n;
