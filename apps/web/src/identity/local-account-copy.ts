import type { Locale } from '../i18n/types';

/**
 * Fork copy for the local account. ODX-5's locale overlay does not exist on
 * this branch, and `Dict` is exhaustive, so these three languages live beside
 * the UI instead of in `locales/*.ts`. Other locales fall back to English.
 */
const ACCOUNT_SENTENCE: Record<'en' | 'zh-CN' | 'th', string> = {
  en: 'This installation uses a local user. The cloud account is not connected.',
  'zh-CN': '当前是本机用户，云账户未接入。',
  th: 'ตอนนี้เป็นผู้ใช้ในเครื่องนี้ บัญชีคลาวด์ยังไม่ได้เชื่อมต่อ',
};

const ACCOUNT_TITLE: Record<'en' | 'zh-CN' | 'th', string> = {
  en: 'Account',
  'zh-CN': '账户',
  th: 'บัญชี',
};

const SHARE_UNAVAILABLE: Record<'en' | 'zh-CN' | 'th', string> = {
  en: 'Sharing is unavailable. This installation uses a local user, and the cloud account is not connected.',
  'zh-CN': '分享暂时不可用。当前是本机用户，云账户未接入。',
  th: 'ยังแชร์ไม่ได้ เพราะบัญชีคลาวด์ยังไม่ได้เชื่อมต่อ ตอนนี้เป็นผู้ใช้ในเครื่องนี้',
};

function language(locale: Locale | string): 'en' | 'zh-CN' | 'th' {
  if (locale === 'zh-CN' || locale === 'zh-TW') return 'zh-CN';
  if (locale === 'th') return 'th';
  return 'en';
}

export function localAccountSentence(locale: Locale | string): string {
  return ACCOUNT_SENTENCE[language(locale)];
}

export function localAccountTitle(locale: Locale | string): string {
  return ACCOUNT_TITLE[language(locale)];
}

export function localShareUnavailable(locale: Locale | string): string {
  return SHARE_UNAVAILABLE[language(locale)];
}
