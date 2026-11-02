import { useI18n } from '../i18n';
import { localAccountSentence, localShareUnavailable } from './local-account-copy';

export function LocalAccountNotice() {
  const { locale } = useI18n();
  return (
    <p data-testid="settings-local-account" role="status">
      {localAccountSentence(locale)}
    </p>
  );
}

export function LocalShareUnavailableNotice() {
  const { locale } = useI18n();
  return (
    <p data-testid="local-share-unavailable" role="status">
      {localShareUnavailable(locale)}
    </p>
  );
}
