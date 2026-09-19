// NWS active alerts (CAP, served as GeoJSON). Structured input, unlike the SRF text —
// the adapter's job is filtering and normalizing, and keeping official wording verbatim.

import { nwsGet } from '../nws';
import type { Alert } from '../types';

export const CAP_SOURCE_ID = 'nws-cap';
export const EAST_COAST_STATES = ['ME', 'NH', 'MA', 'RI', 'CT', 'NY', 'NJ', 'DE', 'MD', 'VA', 'NC', 'SC', 'GA', 'FL'];

interface CapFeature {
  id: string;
  properties: {
    '@id'?: string; id: string; event: string; severity?: string; headline?: string | null;
    description?: string | null; onset?: string | null; effective?: string | null;
    expires?: string | null; ends?: string | null; status: string; messageType: string;
    geocode?: { UGC?: string[] };
  };
}

export async function fetchActiveAlerts(): Promise<Alert[]> {
  const res = await nwsGet<{ features: CapFeature[] }>(
    `https://api.weather.gov/alerts/active?area=${EAST_COAST_STATES.join(',')}`,
    'application/geo+json',
  );
  return res.features
    // Real, current alerts only: drop test/exercise messages and cancellations.
    .filter((f) => f.properties.status === 'Actual' && f.properties.messageType !== 'Cancel')
    .map((f) => {
      const p = f.properties;
      return {
        id: p.id,
        event: p.event,
        severity: p.severity ?? '',
        headline: p.headline ?? p.event,          // verbatim — never paraphrased
        description: p.description ?? '',
        onset: p.onset ?? p.effective ?? null,
        expires: p.ends ?? p.expires ?? null,     // `ends` is when the hazard ends; `expires` is the message
        sourceUrl: p['@id'] ?? f.id,
        zones: p.geocode?.UGC ?? [],
      };
    });
}
