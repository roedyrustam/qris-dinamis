/**
 * Computes CRC-16/CCITT-FALSE checksum (polynomial 0x1021, initial value 0xFFFF)
 * as required by EMVCo QR Code Specification (Tag 63).
 */
export function computeCrc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Verifies the trailing 4-character CRC-16 checksum (Tag 63) of a QRIS string.
 */
export function verifyCrc16(qris: string): boolean {
  if (qris.length < 12) return false;
  const tagPrefix = qris.slice(-8, -4);
  if (tagPrefix !== '6304') return false;
  const bodyWithPrefix = qris.slice(0, -4);
  const actualCrc = qris.slice(-4).toUpperCase();
  const expectedCrc = computeCrc16(bodyWithPrefix);
  return actualCrc === expectedCrc;
}
