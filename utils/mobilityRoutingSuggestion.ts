import type { MobilityIntentRoute, MobilityTripType } from '../types';

/**
 * Heuristique simple d’orientation « interne / externe » (non bloquante).
 * Règles (volontairement minimales, à affiner métier plus tard) :
 * - Mission + petit groupe (≤ 4 passagers) → privilégier prestataire / transport externe
 *   (petit groupe : location taxi / VTC / prestataire souvent plus simple que véhicule de service).
 * - Mission + groupe large (> 4) → privilégier flotte interne / bus organisation.
 * - Course ou autre → interne par défaut (déplacements courts / habituels).
 */
export function suggestMobilityIntentRoute(
  passengerCount: number,
  tripType: MobilityTripType,
): MobilityIntentRoute {
  if (tripType === 'mission') {
    return passengerCount <= 4 ? 'external' : 'internal';
  }
  return 'internal';
}
