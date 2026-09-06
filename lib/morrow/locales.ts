/**
 * A handful of language tags offered as suggestions in Admin. The field takes
 * any BCP 47 tag the browser knows, so this list is a convenience and never a
 * limit: a display can be set to a language nobody thought to list here.
 */
export const COMMON_LOCALES = [
  { tag: 'en-GB', name: 'English (United Kingdom)' },
  { tag: 'en-US', name: 'English (United States)' },
  { tag: 'nb-NO', name: 'Norsk bokmål' },
  { tag: 'nn-NO', name: 'Norsk nynorsk' },
  { tag: 'sv-SE', name: 'Svenska' },
  { tag: 'da-DK', name: 'Dansk' },
  { tag: 'fi-FI', name: 'Suomi' },
  { tag: 'is-IS', name: 'Íslenska' },
  { tag: 'de-DE', name: 'Deutsch' },
  { tag: 'nl-NL', name: 'Nederlands' },
  { tag: 'fr-FR', name: 'Français' },
  { tag: 'es-ES', name: 'Español' },
  { tag: 'it-IT', name: 'Italiano' },
  { tag: 'pt-PT', name: 'Português' },
  { tag: 'pl-PL', name: 'Polski' },
  { tag: 'vi-VN', name: 'Tiếng Việt' },
  { tag: 'ja-JP', name: '日本語' },
] as const;
