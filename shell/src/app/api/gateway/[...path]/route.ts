import { NextRequest, NextResponse } from 'next/server';

const GW_URL = process.env.GATEWAY_URL || 'http://localhost:4000';
const GW_TOKEN = process.env.GATEWAY_AGENT_TOKEN || process.env.GATEWAY_ADMIN_TOKEN || '';

/**
 * Proxy all /api/gateway/* requests to ASuite Gateway /api/*
 */
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, await req.text());
}

export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, await req.text());
}

export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, await req.text());
}

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

async function proxy(req: NextRequest, pathParts: string[], body?: string) {
  const gwPath = '/api/' + pathParts.join('/');
  const url = new URL(gwPath, GW_URL);

  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${GW_TOKEN}`,
  };

  const ct = req.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;

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
