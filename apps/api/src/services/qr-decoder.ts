import { validateQris } from '@qris-dinamis/core';
import { Jimp } from 'jimp';
import jsQR from 'jsqr';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Decodes a QR code from an uploaded image buffer (PNG, JPEG, BMP, GIF, TIFF)
 * and validates that the payload is a compliant EMVCo QRIS string.
 */
export async function decodeQrisFromBuffer(buffer: Buffer): Promise<{
  staticQris: string;
  validation: ReturnType<typeof validateQris>;
}> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Uploaded image file is empty');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Image file exceeds maximum allowed size of 10MB');
  }

  const image = await Jimp.read(buffer);

  // Downscale oversized camera photos for faster and more reliable QR detection
  if (image.bitmap.width > 1200) {
    image.resize({ w: 1200 });
  }

  const { data, width, height } = image.bitmap;
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);

  const decoded = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
  if (!decoded || !decoded.data) {
    throw new Error('No QR code detected in the uploaded image');
  }

  const staticQris = decoded.data.trim();
  const validation = validateQris(staticQris);
  if (!validation.valid) {
    throw new Error(`Decoded QR is not a valid QRIS: ${validation.errors.join('; ')}`);
  }

  return { staticQris, validation };
}

/**
 * Extracts a Buffer from either a base64 string (with or without data URL prefix).
 */
export function bufferFromBase64(input: string): Buffer {
  const cleaned = input.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').trim();
  return Buffer.from(cleaned, 'base64');
}
