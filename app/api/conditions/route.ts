import { getZoneConditions } from '@/lib/conditions';

// Latest per-zone conditions for both forecast periods, with full provenance.
export async function GET() {
  try {
    const zones = await getZoneConditions();
    return Response.json({ generatedAt: new Date().toISOString(), zones });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
