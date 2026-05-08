import { NextRequest, NextResponse } from 'next/server';

// In app mode (static export), this route is excluded from the build.
// Shell connects directly to gateway instead.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') || '*';
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
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
    'X-Forwarded-Host': req.headers.get('x-forwarded-host') || req.headers.get('host') || '',
    'X-Forwarded-Proto': req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'https',
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

  // SSE endpoints need streaming passthrough: buffering to arrayBuffer() kills
  // the long-lived event stream. Detect by path suffix and route through the
  // upstream response body directly.
  const joinedPath = pathParts.join('/');
  const isSSE = joinedPath === 'notifications/stream' || joinedPath === 'me/events/stream';

  if (isSSE) {
    // SSE endpoints authenticate via ?token= query param (EventSource can't set
    // headers). If the client didn't send their own Authorization header, drop
    // the shell's fallback GW_TOKEN — otherwise gateway authenticates every
    // public SSE as whoever owns GW_TOKEN, starving real agents of their events.
    const sseHeaders: Record<string, string> = { ...headers, Accept: 'text/event-stream' };
    if (!clientAuth) delete sseHeaders.Authorization;
    const resp = await fetch(url.toString(), {
      method: req.method,
      headers: sseHeaders,
      // @ts-expect-error Node fetch supports duplex but types don't expose it
      duplex: 'half',
      signal: req.signal,
    });
    if (!resp.ok || !resp.body) {
      return new NextResponse(null, { status: resp.status });
    }
    const upstream = resp.body.getReader();
    const stream = new ReadableStream({
      async start(controller) {
        // Flush headers to client immediately — without an initial chunk,
        // Next.js buffers the response until upstream sends something.
        controller.enqueue(new TextEncoder().encode(': connected\n\n'));
        try {
          while (true) {
            const { done, value } = await upstream.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch {
          // client disconnect or upstream error
        } finally {
          controller.close();
          try { upstream.releaseLock(); } catch {}
        }
      },
      cancel() {
        try { upstream.cancel(); } catch {}
      },
    });
    return new NextResponse(stream, {
      status: resp.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const resp = await fetch(url.toString(), {
    method: req.method,
    headers,
    body,
  });

  const data = await resp.arrayBuffer();
  const contentType = resp.headers.get('Content-Type') || 'application/json';
  const origin = req.headers.get('origin');
  const respHeaders: Record<string, string> = {
    'Content-Type': contentType,
    ...(origin && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  // Cache uploaded files (images, etc.)
  if (pathParts[0] === 'uploads' && (contentType.startsWith('image/') || contentType.startsWith('application/'))) {
    respHeaders['Cache-Control'] = 'public, max-age=31536000, immutable';
  }

  return new NextResponse(data, { status: resp.status, headers: respHeaders });
}
