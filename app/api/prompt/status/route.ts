import { accessCode } from '@/lib/prompt-engine/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  const configured = Boolean(process.env.OPENAI_API_KEY) && (!process.env.VERCEL || Boolean(accessCode()));
  return Response.json({ configured, accessRequired: Boolean(accessCode()) }, { headers: { 'Cache-Control': 'no-store' } });
}
