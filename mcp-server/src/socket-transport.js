import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';

/**
 * MCP server transport over a single duplex byte stream (e.g. a unix domain
 * socket connection). Speaks the same newline-delimited JSON-RPC framing as
 * StdioServerTransport.
 *
 * One transport instance per client connection. The owning server creates a
 * fresh McpServer + SocketServerTransport pair for every accepted connection.
 */
export class SocketServerTransport {
  constructor(socket) {
    this._socket = socket;
    this._readBuffer = new ReadBuffer();
    this._started = false;

    this._ondata = (chunk) => {
      this._readBuffer.append(chunk);
      this._processReadBuffer();
    };
    this._onerror = (error) => {
      this.onerror?.(error);
    };
    this._onclose = () => {
      this._readBuffer.clear();
      this.onclose?.();
    };
  }

  async start() {
    if (this._started) {
      throw new Error('SocketServerTransport already started');
    }
    this._started = true;
    this._socket.on('data', this._ondata);
    this._socket.on('error', this._onerror);
    this._socket.on('close', this._onclose);
  }

  _processReadBuffer() {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) break;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }

  async close() {
    this._socket.off('data', this._ondata);
    this._socket.off('error', this._onerror);
    this._socket.off('close', this._onclose);
    this._readBuffer.clear();
    if (!this._socket.destroyed) this._socket.end();
    this.onclose?.();
  }

  send(message) {
    return new Promise((resolve, reject) => {
      const json = serializeMessage(message);
      this._socket.write(json, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
