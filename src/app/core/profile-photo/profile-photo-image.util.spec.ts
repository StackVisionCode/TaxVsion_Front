import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_MAX_INPUT_BYTES,
  PROFILE_PHOTO_MESSAGES,
  ProfilePhotoError,
  isProbablyImage,
  jpegFileName,
  prepareProfilePhoto,
  squareCrop,
  validatePhotoInput,
} from './profile-photo-image.util';

describe('squareCrop', () => {
  it('recorta el cuadrado centrado de una foto apaisada y la baja a 1024', () => {
    expect(squareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, size: 3000, outSize: 1024 });
  });

  it('recorta el cuadrado centrado de una foto vertical', () => {
    expect(squareCrop(600, 900)).toEqual({ sx: 0, sy: 150, size: 600, outSize: 600 });
  });

  it('nunca agranda una imagen chica', () => {
    expect(squareCrop(200, 200)).toEqual({ sx: 0, sy: 0, size: 200, outSize: 200 });
  });

  it('respeta un lado máximo propio y lados impares', () => {
    expect(squareCrop(1001, 2000, 512)).toEqual({ sx: 0, sy: 499, size: 1001, outSize: 512 });
  });
});

describe('validación previa', () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size });

  it('acepta imágenes por MIME y HEIC sin MIME por extensión', () => {
    expect(isProbablyImage(file('a.png', 'image/png'))).toBe(true);
    expect(isProbablyImage(file('IMG_0001.HEIC', ''))).toBe(true);
  });

  it('rechaza lo que no es imagen', () => {
    expect(isProbablyImage(file('cv.pdf', 'application/pdf'))).toBe(false);
    expect(isProbablyImage(file('notes.txt', ''))).toBe(false);
    expect(validatePhotoInput(file('cv.pdf', 'application/pdf'))).toBe(PROFILE_PHOTO_MESSAGES.notImage);
  });

  it('rechaza un original desmesurado antes de decodificarlo', () => {
    expect(validatePhotoInput(file('big.jpg', 'image/jpeg', PROFILE_PHOTO_MAX_INPUT_BYTES + 1))).toBe(
      PROFILE_PHOTO_MESSAGES.inputTooLarge,
    );
    expect(validatePhotoInput(file('ok.jpg', 'image/jpeg', 8 * 1024 * 1024))).toBeNull();
  });

  it('el nombre de salida siempre es .jpg', () => {
    expect(jpegFileName('IMG_0001.HEIC')).toBe('IMG_0001.jpg');
    expect(jpegFileName('my.photo.png')).toBe('my.photo.jpg');
    expect(jpegFileName('')).toBe('profile-photo.jpg');
  });
});

describe('prepareProfilePhoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Simula el decode y el canvas (jsdom no los implementa). */
  function stubBrowser(width: number, height: number, blobSize = 50_000) {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width, height, close }));
    const drawImage = vi.fn();
    const context = { fillRect: vi.fn(), drawImage, fillStyle: '', imageSmoothingQuality: 'low' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
        cb(new Blob([new Uint8Array(blobSize)], { type }));
      });
    return { close, drawImage, toBlob };
  }

  it('devuelve un JPEG cuadrado con el recorte centrado', async () => {
    const { close, drawImage, toBlob } = stubBrowser(3000, 2000);

    const out = await prepareProfilePhoto(new File(['x'], 'IMG.HEIC', { type: 'image/heic' }));

    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('IMG.jpg');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 500, 0, 2000, 2000, 0, 0, 1024, 1024);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9);
    expect(close).toHaveBeenCalled();
  });

  it('rechaza imágenes de menos de 64 px', async () => {
    stubBrowser(40, 400);

    await expect(prepareProfilePhoto(new File(['x'], 'tiny.png', { type: 'image/png' }))).rejects.toThrow(
      PROFILE_PHOTO_MESSAGES.tooSmall,
    );
  });

  it('si ni con menos calidad baja de 5 MB, lo rechaza con mensaje', async () => {
    const { toBlob } = stubBrowser(1024, 1024, PROFILE_PHOTO_MAX_BYTES + 1);

    const error = await prepareProfilePhoto(new File(['x'], 'huge.png', { type: 'image/png' })).catch(e => e);

    expect(error).toBeInstanceOf(ProfilePhotoError);
    expect(error.message).toBe(PROFILE_PHOTO_MESSAGES.tooLarge);
    expect(toBlob).toHaveBeenCalledTimes(2);
  });

  it('rechaza lo que no es imagen sin intentar decodificarlo', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);

    await expect(prepareProfilePhoto(new File(['x'], 'doc.pdf', { type: 'application/pdf' }))).rejects.toThrow(
      PROFILE_PHOTO_MESSAGES.notImage,
    );
    expect(decode).not.toHaveBeenCalled();
  });
});
