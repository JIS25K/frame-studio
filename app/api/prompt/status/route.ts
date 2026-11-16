export const dynamic = 'force-dynamic';
export async function GET() {
  const configured = Boolean(process.env.OPENAI_API_KEY);
  return Response.json({ configured, accessRequired: false }, { headers: { 'Cache-Control': 'no-store' } });
}
