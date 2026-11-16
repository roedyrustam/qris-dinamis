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

class TransactionEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit(event: TransactionStatusEvent): void {
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

export const transactionEvents = new TransactionEventBus();
