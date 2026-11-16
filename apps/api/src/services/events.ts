import { EventEmitter } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';

export interface TransactionStatusEvent {
  transactionId: string;
  merchantId: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED';
  totalAmount: number;
  paidVia?: string | null;
  paidReference?: string | null;
  paidAt?: string | null;
  expiresAt: string;
  updatedAt: string;
}

/**
 * Pluggable transport for multi-instance SSE fan-out (e.g. Redis Pub/Sub or NATS).
 */
export interface EventBusTransport {
  publish(event: TransactionStatusEvent): void | Promise<void>;
  subscribe(
    transactionId: string,
    listener: (event: TransactionStatusEvent) => void,
  ): () => void;
  close?(): Promise<void> | void;
}

export class InMemoryEventTransport implements EventBusTransport {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: TransactionStatusEvent): void {
    this.emitter.emit(`tx:${event.transactionId}`, event);
  }

  subscribe(
    transactionId: string,
    listener: (event: TransactionStatusEvent) => void,
  ): () => void {
    const channel = `tx:${transactionId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }
}

function encodeRespCommand(args: string[]): string {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const byteLen = Buffer.byteLength(arg, 'utf8');
    parts.push(`$${byteLen}\r\n${arg}\r\n`);
  }
  return parts.join('');
}

function parseRespFrames(buffer: string): { frames: string[][]; rest: string } {
  const frames: string[][] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const lineEnd = buffer.indexOf('\r\n', cursor);
    if (lineEnd === -1) break;

    const header = buffer.slice(cursor, lineEnd);
    if (!header.startsWith('*')) {
      cursor = lineEnd + 2;
      continue;
    }

    const count = Number.parseInt(header.slice(1), 10);
    if (!Number.isFinite(count) || count < 0) {
      cursor = lineEnd + 2;
      continue;
    }

    let pos = lineEnd + 2;
    const items: string[] = [];
    let incomplete = false;

    for (let i = 0; i < count; i++) {
      const itemEnd = buffer.indexOf('\r\n', pos);
      if (itemEnd === -1) {
        incomplete = true;
        break;
      }
      const prefix = buffer.slice(pos, itemEnd);
      if (prefix.startsWith('$')) {
        const len = Number.parseInt(prefix.slice(1), 10);
        if (len === -1) {
          items.push('');
          pos = itemEnd + 2;
        } else {
          const dataStart = itemEnd + 2;
          if (dataStart + len + 2 > buffer.length) {
            incomplete = true;
            break;
          }
          items.push(buffer.slice(dataStart, dataStart + len));
          pos = dataStart + len + 2;
        }
      } else {
        items.push(prefix.slice(1));
        pos = itemEnd + 2;
      }
    }

    if (incomplete) break;
    frames.push(items);
    cursor = pos;
  }

  return { frames, rest: buffer.slice(cursor) };
}

/**
 * Lightweight zero-dependency Redis Pub/Sub transport over RESP2 (supports redis:// and rediss://).
 */
export class RedisEventTransport implements EventBusTransport {
  private readonly url: URL;
  private readonly channelPrefix: string;
  private readonly localEmitter = new EventEmitter();
  private pubSocket: net.Socket | null = null;
  private subSocket: net.Socket | null = null;
  private subBuffer = '';
  private closed = false;

  constructor(redisUrl: string, channelPrefix = 'qris:tx:') {
    this.url = new URL(redisUrl);
    this.channelPrefix = channelPrefix;
    this.localEmitter.setMaxListeners(0);
    this.ensureSubscriber();
  }

  private openSocket(): net.Socket {
    const port = Number(this.url.port || (this.url.protocol === 'rediss:' ? 6380 : 6379));
    const host = this.url.hostname || '127.0.0.1';
    const socket =
      this.url.protocol === 'rediss:'
        ? tls.connect({ host, port })
        : net.connect({ host, port });

    socket.setKeepAlive(true);
    if (this.url.password) {
      const authArgs = this.url.username
        ? ['AUTH', decodeURIComponent(this.url.username), decodeURIComponent(this.url.password)]
        : ['AUTH', decodeURIComponent(this.url.password)];
      socket.write(encodeRespCommand(authArgs));
    }
    return socket;
  }

  private ensurePublisher(): net.Socket {
    if (this.pubSocket && !this.pubSocket.destroyed) {
      return this.pubSocket;
    }
    const socket = this.openSocket();
    socket.on('error', () => {
      // Swallow transient socket errors; next publish reconnects
    });
    this.pubSocket = socket;
    return socket;
  }

  private ensureSubscriber(): void {
    if (this.closed || (this.subSocket && !this.subSocket.destroyed)) {
      return;
    }
    const socket = this.openSocket();
    socket.write(encodeRespCommand(['PSUBSCRIBE', `${this.channelPrefix}*`]));

    socket.on('data', (chunk) => {
      this.subBuffer += chunk.toString('utf8');
      const { frames, rest } = parseRespFrames(this.subBuffer);
      this.subBuffer = rest;

      for (const frame of frames) {
        if (frame[0] === 'pmessage' && frame[2] && frame[3]) {
          try {
            const event = JSON.parse(frame[3]) as TransactionStatusEvent;
            this.localEmitter.emit(`tx:${event.transactionId}`, event);
          } catch {
            // Ignore malformed JSON payloads
          }
        }
      }
    });

    socket.on('error', () => {
      // Reconnect handled on close
    });
    socket.on('close', () => {
      this.subSocket = null;
      if (!this.closed) {
        setTimeout(() => this.ensureSubscriber(), 2000).unref();
      }
    });

    this.subSocket = socket;
  }

  publish(event: TransactionStatusEvent): void {
    if (this.closed) return;
    const channel = `${this.channelPrefix}${event.transactionId}`;
    const socket = this.ensurePublisher();
    socket.write(encodeRespCommand(['PUBLISH', channel, JSON.stringify(event)]));
  }

  subscribe(
    transactionId: string,
    listener: (event: TransactionStatusEvent) => void,
  ): () => void {
    const channel = `tx:${transactionId}`;
    this.localEmitter.on(channel, listener);
    return () => {
      this.localEmitter.off(channel, listener);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.pubSocket?.destroy();
    this.subSocket?.destroy();
    this.pubSocket = null;
    this.subSocket = null;
  }
}

class TransactionEventBus {
  private transport: EventBusTransport = new InMemoryEventTransport();

  setTransport(transport: EventBusTransport): void {
    this.transport = transport;
  }

  initFromEnv(): void {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (redisUrl) {
      this.transport = new RedisEventTransport(redisUrl);
    }
  }

  emit(event: TransactionStatusEvent): void {
    void this.transport.publish(event);
  }

  subscribe(
    transactionId: string,
    listener: (event: TransactionStatusEvent) => void,
  ): () => void {
    return this.transport.subscribe(transactionId, listener);
  }

  async close(): Promise<void> {
    await this.transport.close?.();
  }
}

export const transactionEvents = new TransactionEventBus();
