import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.GATEWAY_JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET or GATEWAY_JWT_SECRET environment variable is required');
  }
  return secret;
}

const BR_URL = process.env.BR_URL || 'http://localhost:8280';
const BR_EMAIL = process.env.BR_EMAIL || 'admin@asuite.local';
const BR_PASSWORD = process.env.BR_PASSWORD || process.env.ADMIN_PASSWORD || '';

async function getBaserowToken() {
  if (!BR_PASSWORD) return null;
  const res = await fetch(`${BR_URL}/api/user/token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: BR_EMAIL, password: BR_PASSWORD }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { token: data.token };
}

export async function GET(req: NextRequest) {
  // Verify JWT from Authorization header
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    jwt.verify(token, getJwtSecret());
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const baserow = await getBaserowToken();

  return NextResponse.json({
    baserow: baserow || null,
  });
}
