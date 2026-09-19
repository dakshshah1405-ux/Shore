// Thin client for api.weather.gov. The NWS API rejects requests without a
// User-Agent, and asks that it carry contact info — set NWS_USER_AGENT.

const UA = process.env.NWS_USER_AGENT || 'Shore/0.1 (SteelHacks XIII hackathon project)';

export const EAST_COAST_WFOS = [
  'GYX', 'CAR', 'BOX', 'OKX', 'PHI', 'AKQ', 'MHX', 'ILM', 'CHS', 'JAX', 'MLB', 'MFL',
] as const;

// Product endpoints are JSON-LD. Geometry endpoints must ask for GeoJSON: in the
// JSON-LD representation NWS returns geometry as a WKT string, not coordinates.
export async function nwsGet<T>(url: string, accept = 'application/ld+json'): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: accept },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`NWS ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export interface NwsProduct {
  '@id': string;
  id: string;
  issuanceTime: string;
  issuingOffice: string;
  productCode: string;
  productText: string;
}

interface ProductList {
  '@graph': { '@id': string; id: string; issuanceTime: string }[];
}

// Latest product of a type (SRF, SPS, ...) for one forecast office, or null if none.
export async function latestProduct(type: string, wfo: string): Promise<NwsProduct | null> {
  const list = await nwsGet<ProductList>(
    `https://api.weather.gov/products/types/${type}/locations/${wfo}`,
  );
  const latest = list['@graph']?.[0];
  if (!latest) return null;
  return nwsGet<NwsProduct>(latest['@id']);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
