/**
 * Business context: supplies military danger-zone translations to the shared
 * map information panel used for localized official GeoAdmin metadata.
 */
import { useI18n } from '../i18n/I18nContext';
import MapInformationPopup, {
  type MapInformationPopupStatus,
} from './MapInformationPopup';

/** Async popup content produced after a map click on the danger-zone overlay. */
export type ShootingDangerZonePopupStatus = MapInformationPopupStatus;

/** Display state and close callback for the temporary danger-zone panel. */
interface ShootingDangerZonePopupProps {
  /** Current loading, ready, or error state. */
  status: ShootingDangerZonePopupStatus;
  /** Dismisses the panel and aborts any active metadata request. */
  onClose: () => void;
}

/** Renders official shooting-notice metadata with translated project labels. */
export default function ShootingDangerZonePopup({
  status,
  onClose,
}: ShootingDangerZonePopupProps) {
  const { t } = useI18n();

  return (
    <MapInformationPopup
      title={t('shootingDangerZones.title')}
      closeLabel={t('shootingDangerZones.close')}
      loadingLabel={t('shootingDangerZones.loading')}
      errorLabel={t('shootingDangerZones.loadError')}
      status={status}
      onClose={onClose}
    />
  );
}
