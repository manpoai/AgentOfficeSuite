import { NextRequest, NextResponse } from 'next/server';

const MM_URL = process.env.MM_URL || 'http://localhost:8065';
const MM_TOKEN = process.env.MM_ADMIN_TOKEN || '';

/**
 * Proxy all /api/mm/* requests to Mattermost /api/v4/*
 * Adds admin auth header server-side (avoids CORS + token exposure)
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

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

async function proxy(req: NextRequest, pathParts: string[], body?: string) {
  const mmPath = '/api/v4/' + pathParts.join('/');
  const url = new URL(mmPath, MM_URL);

  // Forward query params
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${MM_TOKEN}`,
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
