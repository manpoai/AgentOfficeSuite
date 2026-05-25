/**
 * AOSE Gateway HTTP client.
 * Thin wrapper around fetch with auth header injection.
 */
export class GatewayClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const headers = { Authorization: `Bearer ${this.token}` };
    const opts = { method, headers };

    if (body && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (res.status >= 400) {
      const msg = data?.message || data?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async getBuffer(path) {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (res.status >= 400) {
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
  patch(path, body) { return this.request('PATCH', path, body); }
  put(path, body) { return this.request('PUT', path, body); }
  del(path) { return this.request('DELETE', path); }
}
