import { NextRequest, NextResponse } from 'next/server';

const GW_URL = process.env.GATEWAY_URL;
const GW_TOKEN = process.env.GATEWAY_AGENT_TOKEN || process.env.GATEWAY_ADMIN_TOKEN || '';

/**
 * Proxy all /api/gateway/* requests to AOSE Gateway /api/*
 */
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, true);
}

export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, true);
}

export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, true);
}

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  // Only pass body if request has content (e.g. unlink records sends JSON body)
  const hasContent = req.headers.get('content-type') || req.headers.get('content-length');
  return proxy(req, params.path, !!hasContent);
}

async function proxy(req: NextRequest, pathParts: string[], hasBody?: boolean) {
  if (!GW_URL) {
    return NextResponse.json({ error: 'GATEWAY_URL_NOT_CONFIGURED' }, { status: 500 });
  }

  const gwPath = '/api/' + pathParts.join('/');
  const url = new URL(gwPath, GW_URL);

  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  // Forward the client's Authorization header if present, otherwise fall back to GW_TOKEN
  const clientAuth = req.headers.get('authorization');
  const headers: Record<string, string> = {
    'Authorization': clientAuth || `Bearer ${GW_TOKEN}`,
    'X-Forwarded-Host': req.headers.get('host') || '',
    'X-Forwarded-Proto': req.nextUrl.protocol.replace(':', '') || 'https',
  };

  const ct = req.headers.get('content-type') || '';
  const isMultipart = ct.includes('multipart/form-data');

  // For multipart/form-data, pass body as raw bytes to preserve the boundary
  // For other content types, pass as text and set Content-Type
  let body: BodyInit | undefined;
  if (hasBody) {
    if (isMultipart) {
      body = await req.arrayBuffer();
      headers['Content-Type'] = ct; // Preserve original with boundary
    } else {
      const text = await req.text();
      if (text) {
        body = text;
        if (ct) headers['Content-Type'] = ct;
      }
    }
  }

  const resp = await fetch(url.toString(), {
    method: req.method,
    headers,
    body,
  });

  const data = await resp.arrayBuffer();
  const contentType = resp.headers.get('Content-Type') || 'application/json';
  const respHeaders: Record<string, string> = { 'Content-Type': contentType };

  // Cache uploaded files (images, etc.)
  if (pathParts[0] === 'uploads' && (contentType.startsWith('image/') || contentType.startsWith('application/'))) {
    respHeaders['Cache-Control'] = 'public, max-age=31536000, immutable';
  }

  return new NextResponse(data, { status: resp.status, headers: respHeaders });
}
