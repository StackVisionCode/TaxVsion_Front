/**
 * Lado mayor al que se reescala una imagen antes de meterla en el lienzo. El documento
 * entero vive en `localStorage` (unos 5 MB para TODO el origen), así que una foto de
 * cámara tal cual lo llenaría ella sola y dejaría de guardarse hasta el propio diagrama.
 */
const MAX_EDGE = 1400;
/** Tope del data URL ya comprimido. Por encima se rechaza en vez de romper el guardado. */
const MAX_DATA_URL_BYTES = 1_200_000;
const JPEG_QUALITY = 0.82;

export interface PreparedImage {
  src: string;
  width: number;
  height: number;
}

export class ImageTooLargeError extends Error {
  constructor() {
    super('That image is too large to keep in a local draft. Try one under 2 MB.');
    this.name = 'ImageTooLargeError';
  }
}

/**
 * Lee un archivo de imagen y lo devuelve como data URL reescalada, junto con el tamaño con
 * el que debe dibujarse en el lienzo (respeta la proporción original).
 *
 * Se reescala SIEMPRE, no solo si es grande: el coste es el mismo y así el tamaño del
 * documento es predecible. Un PNG con transparencia se conserva como PNG; el resto va a
 * JPEG, que para una captura o una foto pesa una fracción.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new ImageTooLargeError();
    }
    context.drawImage(bitmap, 0, 0, width, height);

    const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
    const src = keepAlpha
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', JPEG_QUALITY);

    if (src.length > MAX_DATA_URL_BYTES) {
      // Segundo intento en JPEG aunque el original tuviera alfa: mejor perder la
      // transparencia que no poder insertar la imagen.
      const fallback = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      if (fallback.length > MAX_DATA_URL_BYTES) {
        throw new ImageTooLargeError();
      }
      return { src: fallback, width, height };
    }
    return { src, width, height };
  } finally {
    bitmap.close();
  }
}
