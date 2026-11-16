import QRCode from 'qrcode';

export interface QrRenderOptions {
  width?: number;
  margin?: number;
  color?: {
    dark?: string;
    light?: string;
  };
}

/**
 * Renders a QRIS string as an SVG markup string.
 */
export async function renderQrSvg(qris: string, options?: QrRenderOptions): Promise<string> {
  return QRCode.toString(qris, {
    type: 'svg',
    width: options?.width ?? 320,
    margin: options?.margin ?? 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: options?.color?.dark ?? '#000000',
      light: options?.color?.light ?? '#FFFFFF',
    },
  });
}

/**
 * Renders a QRIS string as a PNG base64 Data URL (`data:image/png;base64,...`).
 */
export async function renderQrDataUrl(qris: string, options?: QrRenderOptions): Promise<string> {
  return QRCode.toDataURL(qris, {
    width: options?.width ?? 320,
    margin: options?.margin ?? 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: options?.color?.dark ?? '#000000',
      light: options?.color?.light ?? '#FFFFFF',
    },
  });
}

/**
 * Renders a QRIS string as a UTF-8 terminal-friendly ASCII/block QR code.
 */
export async function renderQrTerminal(qris: string): Promise<string> {
  return QRCode.toString(qris, {
    type: 'utf8',
    errorCorrectionLevel: 'M',
  });
}
