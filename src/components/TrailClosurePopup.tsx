/**
 * Business context: supplies closure-specific translations to the shared map
 * information panel used for official GeoAdmin feature metadata.
 */
import { useI18n } from '../i18n/I18nContext';
import MapInformationPopup, {
  type MapInformationPopupStatus,
} from './MapInformationPopup';

/** Async popup content produced after a map click on the closure overlay. */
export type TrailClosurePopupStatus = MapInformationPopupStatus;

/** Display state and close callback for the temporary closure panel. */
interface TrailClosurePopupProps {
  /** Current loading, ready, or error state. */
  status: TrailClosurePopupStatus;
  /** Dismisses the panel and aborts any active metadata request. */
  onClose: () => void;
}

/** Renders official closure metadata with translated project labels. */
export default function TrailClosurePopup({
  status,
  onClose,
}: TrailClosurePopupProps) {
  const { t } = useI18n();

  return (
    <MapInformationPopup
      title={t('closures.title')}
      closeLabel={t('closures.close')}
      loadingLabel={t('closures.loading')}
      errorLabel={t('closures.loadError')}
      status={status}
      onClose={onClose}
    />
  );
}
