import { describe, expect, it } from 'vitest';
import { QrisCheckout, useQrisStatus } from '../index.js';

describe('@qris-dinamis/react', () => {
  it('exports QrisCheckout component and useQrisStatus hook', () => {
    expect(typeof QrisCheckout).toBe('function');
    expect(typeof useQrisStatus).toBe('function');
  });
});
