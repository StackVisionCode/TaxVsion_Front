import { InjectionToken } from '@angular/core';

/**
 * Prepara en el navegador la foto de perfil antes de subirla: recorte cuadrado al centro, lado máximo
 * 1024 px y re-codificación a JPEG. Así se convierte HEIC (donde el navegador lo decodifica), se quitan
 * casi todos los metadatos (EXIF/GPS) y el archivo baja mucho. El backend vuelve a normalizar igual.
 */

/** Preparación inyectable (los tests del store la reemplazan sin tocar canvas). */
export type ProfilePhotoPreparer = (file: File) => Promise<File>;
export const PROFILE_PHOTO_PREPARER = new InjectionToken<ProfilePhotoPreparer>('PROFILE_PHOTO_PREPARER', {
  providedIn: 'root',
  factory: () => prepareProfilePhoto,
});

/** Tope del backend (Avatar.TooLarge → 413). */
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** Tope del archivo ORIGINAL: decodificar algo más grande puede colgar la pestaña. */
export const PROFILE_PHOTO_MAX_INPUT_BYTES = 30 * 1024 * 1024;
/** Lado mínimo que acepta el backend (Avatar.TooSmall). */
export const PROFILE_PHOTO_MIN_EDGE = 64;
export const PROFILE_PHOTO_MAX_EDGE = 1024;
const JPEG_QUALITY = 0.9;
const JPEG_FALLBACK_QUALITY = 0.75;

/** `accept` del input y del drop: cualquier imagen + HEIC/HEIF, que Windows suele mandar sin MIME. */
export const PROFILE_PHOTO_ACCEPT = 'image/*,.heic,.heif';

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;

/** Error con texto listo para el usuario. */
export class ProfilePhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfilePhotoError';
  }
}

export const PROFILE_PHOTO_MESSAGES = {
  notImage: 'Choose an image file (JPG, PNG, WebP or HEIC).',
  inputTooLarge: 'That file is too large. Choose an image under 30 MB.',
  unreadable: "We couldn't read that image. Try a JPG or PNG.",
  tooSmall: `That image is too small. Use one at least ${PROFILE_PHOTO_MIN_EDGE} × ${PROFILE_PHOTO_MIN_EDGE} pixels.`,
  tooLarge: 'That photo is larger than 5 MB. Try a smaller image.',
} as const;

/** ¿Parece una imagen? MIME `image/*` o, si el navegador no dio MIME, la extensión. */
export function isProbablyImage(file: Pick<File, 'name' | 'type'>): boolean {
  const type = (file.type || '').toLowerCase();
  if (type) {
    return type.startsWith('image/');
  }
  return IMAGE_EXTENSIONS.test(file.name || '');
}

/** Validación previa al decode; devuelve el mensaje o null. */
export function validatePhotoInput(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (!isProbablyImage(file)) {
    return PROFILE_PHOTO_MESSAGES.notImage;
  }
  if (file.size > PROFILE_PHOTO_MAX_INPUT_BYTES) {
    return PROFILE_PHOTO_MESSAGES.inputTooLarge;
  }
  return null;
}

export interface SquareCrop {
  /** Origen del recorte en la imagen fuente. */
  sx: number;
  sy: number;
  /** Lado del cuadrado recortado en la fuente. */
  size: number;
  /** Lado del lienzo de salida (≤ maxEdge). */
  outSize: number;
}

/** Cuadrado centrado más grande que cabe en la imagen, reescalado a `maxEdge` como mucho (nunca agranda). */
export function squareCrop(width: number, height: number, maxEdge = PROFILE_PHOTO_MAX_EDGE): SquareCrop {
  const size = Math.max(0, Math.min(Math.floor(width), Math.floor(height)));
  return {
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size,
    outSize: Math.min(size, maxEdge),
  };
}

/** `foto.HEIC` → `foto.jpg`. */
export function jpegFileName(original: string): string {
  const base = (original || '').replace(/\.[^./\\]+$/, '').trim();
  return `${base || 'profile-photo'}.jpg`;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * Lee la imagen elegida y devuelve un JPEG cuadrado listo para `PUT /auth/me/avatar`.
 * Lanza `ProfilePhotoError` con un mensaje para el usuario.
 */
export async function prepareProfilePhoto(file: File): Promise<File> {
  const invalid = validatePhotoInput(file);
  if (invalid) {
    throw new ProfilePhotoError(invalid);
  }

  const image = await decodeImage(file);
  try {
    if (Math.min(image.width, image.height) < PROFILE_PHOTO_MIN_EDGE) {
      throw new ProfilePhotoError(PROFILE_PHOTO_MESSAGES.tooSmall);
    }
    const crop = squareCrop(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = crop.outSize;
    canvas.height = crop.outSize;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new ProfilePhotoError(PROFILE_PHOTO_MESSAGES.unreadable);
    }
    // JPEG no tiene alfa: sin fondo blanco, un PNG transparente saldría negro.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, crop.outSize, crop.outSize);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image.source, crop.sx, crop.sy, crop.size, crop.size, 0, 0, crop.outSize, crop.outSize);

    let blob = await canvasToJpeg(canvas, JPEG_QUALITY);
    if (blob.size > PROFILE_PHOTO_MAX_BYTES) {
      blob = await canvasToJpeg(canvas, JPEG_FALLBACK_QUALITY);
    }
    if (blob.size > PROFILE_PHOTO_MAX_BYTES) {
      throw new ProfilePhotoError(PROFILE_PHOTO_MESSAGES.tooLarge);
    }
    return new File([blob], jpegFileName(file.name), { type: 'image/jpeg' });
  } finally {
    image.release();
  }
}

/** `createImageBitmap` (respeta la orientación EXIF) y, si no puede, un `<img>` decodificado. */
async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Algunos navegadores solo decodifican ciertos formatos por <img> (p. ej. HEIC en Safari).
    }
  }
  return decodeWithImageElement(file);
}

function decodeWithImageElement(file: File): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () =>
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ProfilePhotoError(PROFILE_PHOTO_MESSAGES.unreadable));
    };
    img.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new ProfilePhotoError(PROFILE_PHOTO_MESSAGES.unreadable))),
      'image/jpeg',
      quality,
    );
  });
}
