/**
 * Computes CRC-16/CCITT-FALSE checksum (polynomial 0x1021, initial value 0xFFFF)
 * over UTF-8 bytes as required by EMVCo QR Code Specification (Tag 63).
 */
export function computeCrc16(payload: string): string {
  const bytes = Buffer.from(payload, 'utf8');
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]! << 8;
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
  const trimmed = qris.trim();
  if (trimmed.length < 12) return false;
  const tagPrefix = trimmed.slice(-8, -4);
  if (tagPrefix !== '6304') return false;
  const bodyWithPrefix = trimmed.slice(0, -4);
  const actualCrc = trimmed.slice(-4).toUpperCase();
  const expectedCrc = computeCrc16(bodyWithPrefix);
  return actualCrc === expectedCrc;
}
