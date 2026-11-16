import { EventEmitter } from 'node:events';

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

class TransactionEventBus {
  private transport: EventBusTransport = new InMemoryEventTransport();

  setTransport(transport: EventBusTransport): void {
    this.transport = transport;
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
}

export const transactionEvents = new TransactionEventBus();
