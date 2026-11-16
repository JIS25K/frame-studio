export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json({ configured: Boolean(process.env.OPENAI_API_KEY), accessRequired: Boolean(process.env.CAPTURE_ACCESS_CODE), model: process.env.CAPTURE_MODEL || 'gpt-5.4-mini' }, { headers: { 'Cache-Control': 'no-store' } });
}
