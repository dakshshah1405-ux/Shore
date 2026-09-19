// Display vocabulary shared by the map, legend, and panel. Risk words mirror NWS
// Low/Moderate/High so Shore never appears to contradict the official source — and
// nothing is ever labeled "safe".

import type { FieldName, RiskLevel } from './types';

export const RISK: Record<RiskLevel, { label: string; long: string; color: string; ink: string }> = {
  official: { label: 'Warning', long: 'Official NWS warning', color: '#6B2FA3', ink: '#4A1D75' },
  high:     { label: 'High',     long: 'High water hazard',        color: '#C62828', ink: '#8E1B1B' },
  elevated: { label: 'Elevated', long: 'Elevated water hazard',    color: '#E07B00', ink: '#8A4B00' },
  lower:    { label: 'Lower',    long: 'Lower modeled risk',       color: '#2E7D4F', ink: '#1D5234' },
  unknown:  { label: 'No data',  long: 'Not enough data to assess', color: '#8B969C', ink: '#4F5A60' },
};

export const RISK_ORDER: RiskLevel[] = ['official', 'high', 'elevated', 'lower', 'unknown'];

export const FIELD_LABEL: Record<FieldName, string> = {
  ripCurrentRisk: 'Rip current risk',
  surfHeight: 'Surf',
  thunderstormPotential: 'Thunderstorms',
  waterTemperature: 'Water temp',
  winds: 'Wind',
  uvIndex: 'UV index',
  weather: 'Weather',
  highTemperature: 'Air temp (high)',
  maxHeatIndex: 'Heat index',
  waterspoutRisk: 'Waterspouts',
  remarks: 'Remarks',
  sunrise: 'Sunrise',
  sunset: 'Sunset',
};

// Always shown, with "Data unavailable" when missing — the safety-relevant core.
export const PRIMARY_FIELDS: FieldName[] = ['ripCurrentRisk', 'surfHeight', 'thunderstormPotential', 'waterTemperature', 'winds'];
// Shown only when the forecast includes them.
export const SECONDARY_FIELDS: FieldName[] = ['uvIndex', 'maxHeatIndex', 'waterspoutRisk', 'weather', 'highTemperature', 'remarks'];

export const SOURCE_NAME: Record<string, string> = {
  'nws-srf': 'NWS Surf Zone Forecast',
  'nws-cap': 'NWS Alerts',
  'nws-sps': 'NWS Special Weather Statement',
};

export function formatEastern(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

export function hoursAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 36e5));
}
