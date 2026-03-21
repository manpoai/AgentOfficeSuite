import { NextRequest, NextResponse } from 'next/server';

const OL_URL = process.env.OUTLINE_URL || 'http://localhost:3000';
const OL_KEY = process.env.OUTLINE_API_KEY || '';

/**
 * Proxy all /api/outline/* requests to Outline /api/*
 * Note: Outline uses POST for most read operations (documents.list, documents.info, etc.)
 */
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, await req.text());
}

async function proxy(req: NextRequest, pathParts: string[], body?: string) {
  const olPath = '/api/' + pathParts.join('/');
  const url = new URL(olPath, OL_URL);

  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${OL_KEY}`,
    'Content-Type': 'application/json',
  };

  const resp = await fetch(url.toString(), {
    method: req.method,
    headers,
    body: body || undefined,
  });

  const data = await resp.text();
  return new NextResponse(data, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  });
}
