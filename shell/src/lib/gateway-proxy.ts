import { NextRequest, NextResponse } from 'next/server';

const GW_URL = process.env.GATEWAY_URL;

/**
 * Proxy a request to the AOSE Gateway, preserving auth headers and streaming.
 */
export async function proxyToGateway(
  req: NextRequest,
  gwPath: string,
  opts?: { hasBody?: boolean; streaming?: boolean },
) {
  if (!GW_URL) {
    return NextResponse.json({ error: 'GATEWAY_URL_NOT_CONFIGURED' }, { status: 500 });
  }

  const url = new URL(gwPath, GW_URL);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const headers: Record<string, string> = {
    'X-Forwarded-Host': req.headers.get('x-forwarded-host') || req.headers.get('host') || '',
    'X-Forwarded-Proto': req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'https',
  };

  const clientAuth = req.headers.get('authorization');
  if (clientAuth) headers['Authorization'] = clientAuth;

  const accept = req.headers.get('accept');
  if (accept) headers['Accept'] = accept;

  const ct = req.headers.get('content-type') || '';
  let body: BodyInit | undefined;
  if (opts?.hasBody) {
    body = await req.arrayBuffer();
    if (ct) headers['Content-Type'] = ct;
  }

  const resp = await fetch(url.toString(), {
    method: req.method,
    headers,
    body,
    redirect: 'manual',
    // @ts-expect-error Node fetch supports duplex
    ...(opts?.hasBody && { duplex: 'half' }),
  });

  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get('Location');
    const respHeaders: Record<string, string> = {};
    if (location) respHeaders['Location'] = location;
    const setCookie = resp.headers.get('Set-Cookie');
    if (setCookie) respHeaders['Set-Cookie'] = setCookie;
    return new NextResponse(null, { status: resp.status, headers: respHeaders });
  }

  if (opts?.streaming && resp.body) {
    const respCt = resp.headers.get('content-type') || '';
    if (respCt.includes('text/event-stream')) {
      const upstream = resp.body.getReader();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await upstream.read();
              if (done) break;
              controller.enqueue(value);
            }
          } catch {
          } finally {
            controller.close();
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
  }

  const data = await resp.arrayBuffer();
  const contentType = resp.headers.get('Content-Type') || 'application/json';
  const respHeaders: Record<string, string> = { 'Content-Type': contentType };
  const wwwAuth = resp.headers.get('WWW-Authenticate');
  if (wwwAuth) respHeaders['WWW-Authenticate'] = wwwAuth;
  const origin = req.headers.get('origin');
  if (origin) {
    respHeaders['Access-Control-Allow-Origin'] = origin;
    respHeaders['Access-Control-Allow-Credentials'] = 'true';
  }

  return new NextResponse(data, { status: resp.status, headers: respHeaders });
}
