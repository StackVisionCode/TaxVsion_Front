import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '@shared/ui/toast/toast.service';
import { MediaDevicesService, PREFERRED_DEVICES_KEY } from './media-devices.service';
import { MediaAccessError } from './media-errors';

/** Captura el error tipado de una promesa que debe rechazar. */
async function failure(promise: Promise<unknown>): Promise<MediaAccessError> {
  try {
    await promise;
  } catch (err) {
    return err as MediaAccessError;
  }
  throw new Error('expected rejection');
}

function domError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

describe('MediaDevicesService (T-59)', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let enumerateDevices: ReturnType<typeof vi.fn>;
  let service: MediaDevicesService;
  let toast: { info: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.removeItem(PREFERRED_DEVICES_KEY);
    getUserMedia = vi.fn();
    enumerateDevices = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices, addEventListener: vi.fn() },
    });
    toast = { info: vi.fn() };
    TestBed.configureTestingModule({ providers: [MediaDevicesService, { provide: ToastService, useValue: toast }] });
    service = TestBed.inject(MediaDevicesService);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });

  it('NotAllowed → bloqueado en el navegador, con guía, y marca el permiso como denegado', async () => {
    getUserMedia.mockRejectedValue(domError('NotAllowedError'));
    const err = await failure(service.getUserMedia({ audio: true }, 'microphone'));
    expect(err).toBeInstanceOf(MediaAccessError);
    expect(err.kind).toBe('NotAllowed');
    expect(err.message).toBe('The microphone is blocked in the browser.');
    expect(err.guidance).toContain('site settings');
    expect(service.microphonePermission()).toBe('denied');
  });

  it('NotReadable → "in use by another app"; NotFound → "no X was found"', async () => {
    getUserMedia.mockRejectedValueOnce(domError('NotReadableError'));
    const busy = await failure(service.getUserMedia({ video: true }, 'camera'));
    expect(busy.kind).toBe('NotReadable');
    expect(busy.message).toBe('The camera is in use by another app.');

    getUserMedia.mockRejectedValueOnce(domError('NotFoundError'));
    const missing = await failure(service.getUserMedia({ audio: true }, 'microphone'));
    expect(missing.kind).toBe('NotFound');
    expect(missing.message).toBe('No microphone was found.');
  });

  it('Overconstrained con deviceId → reintenta SIN deviceId y olvida la preferencia', async () => {
    service.setPreferred('audioInputId', 'mic-old');
    const stream = {} as MediaStream;
    getUserMedia.mockRejectedValueOnce(domError('OverconstrainedError')).mockResolvedValueOnce(stream);

    const result = await service.getUserMedia({ audio: { deviceId: { exact: 'mic-old' }, echoCancellation: true } }, 'microphone');

    expect(result).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: { echoCancellation: true }, video: undefined });
    expect(service.preferred().audioInputId).toBeNull();
    expect(service.microphonePermission()).toBe('granted');
  });

  it('marca "Waiting for permission…" cuando el navegador tarda en responder', async () => {
    vi.useFakeTimers();
    let resolve!: (s: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>(r => (resolve = r)));
    const pending = service.getUserMedia({ audio: true }, 'microphone');
    expect(service.waitingForPermission()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(service.waitingForPermission()).toBe(true);
    resolve({} as MediaStream);
    await pending;
    expect(service.waitingForPermission()).toBe(false);
  });

  it('persiste las preferencias de deviceId en localStorage (tvf.media.devices)', () => {
    service.setPreferred('videoInputId', 'cam-2');
    expect(JSON.parse(localStorage.getItem(PREFERRED_DEVICES_KEY)!)).toMatchObject({ videoInputId: 'cam-2' });
  });

  it('pickFallback elige el preferido si sigue disponible y nunca el perdido ni el alias default', async () => {
    enumerateDevices.mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: 'Default' },
      { kind: 'audioinput', deviceId: 'mic-a', label: 'A' },
      { kind: 'audioinput', deviceId: 'mic-b', label: 'B' },
    ] as MediaDeviceInfo[]);
    await service.refreshInventory();
    service.setPreferred('audioInputId', 'mic-b');
    expect(service.pickFallback('microphone', 'mic-a')?.deviceId).toBe('mic-b');
    expect(service.pickFallback('microphone', 'mic-b')?.deviceId).toBe('mic-a');
  });

  it('avisa la desconexión en caliente', () => {
    service.notifyDeviceLost('microphone', false);
    expect(toast.info).toHaveBeenCalledWith('Your microphone was disconnected.');
  });
});
