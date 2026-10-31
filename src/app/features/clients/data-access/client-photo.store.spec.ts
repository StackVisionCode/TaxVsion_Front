import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import {
  PROFILE_PHOTO_MESSAGES,
  PROFILE_PHOTO_PREPARER,
  ProfilePhotoError,
} from '@core/profile-photo/profile-photo-image.util';
import { PHOTO_POLL_DELAY_MS, PHOTO_POLL_INTERVAL_MS, PHOTO_POLL_MAX_TRIES } from '@core/profile-photo/profile-photo-upload';
import { ClientsStore } from './clients.store';
import {
  CLIENT_PHOTO_FAILED_MESSAGE,
  ClientPhotoStore,
  classifyCustomerAvatarPoll,
  clientPhotoErrorMessage,
} from './client-photo.store';

describe('classifyCustomerAvatarPoll', () => {
  it('updated cuando la foto confirmada ya es la subida', () => {
    expect(classifyCustomerAvatarPoll({ avatarFileId: 'f1', pendingAvatarFileId: null, avatarUploadStatus: null }, 'f1')).toBe('updated');
  });

  it('pending mientras la subida siga pendiente, o si la lectura falló', () => {
    expect(classifyCustomerAvatarPoll({ avatarFileId: 'old', pendingAvatarFileId: 'f1', avatarUploadStatus: 'processing' }, 'f1')).toBe('pending');
    expect(classifyCustomerAvatarPoll(null, 'f1')).toBe('pending');
    // Backend sin `pendingAvatarFileId`: decide el estado.
    expect(classifyCustomerAvatarPoll({ avatarFileId: 'old', avatarUploadStatus: 'processing' }, 'f1')).toBe('pending');
  });

  it('failed si se descartó o la reemplazó otra subida', () => {
    expect(classifyCustomerAvatarPoll({ avatarFileId: 'old', pendingAvatarFileId: null, avatarUploadStatus: 'failed' }, 'f1')).toBe('failed');
    expect(classifyCustomerAvatarPoll({ avatarFileId: 'old', pendingAvatarFileId: 'f2', avatarUploadStatus: 'processing' }, 'f1')).toBe('failed');
    expect(classifyCustomerAvatarPoll({ avatarFileId: null, pendingAvatarFileId: null, avatarUploadStatus: null }, 'f1')).toBe('failed');
  });

  // T-20: la moderación de contenido decide antes que "pendiente" o "descartada".
  it('under_review o blocked cuando la moderación retuvo esa foto (no otra)', () => {
    const base = { avatarFileId: 'old', avatarUploadStatus: 'processing' as const };
    expect(classifyCustomerAvatarPoll({ ...base, pendingAvatarFileId: 'f1', avatarModerationStatus: 'under_review', avatarModerationFileId: 'f1' }, 'f1')).toBe('under_review');
    expect(classifyCustomerAvatarPoll({ ...base, pendingAvatarFileId: null, avatarUploadStatus: null, avatarModerationStatus: 'blocked', avatarModerationFileId: 'f1' }, 'f1')).toBe('blocked');
    expect(classifyCustomerAvatarPoll({ ...base, pendingAvatarFileId: 'f1', avatarModerationStatus: 'blocked', avatarModerationFileId: 'f0' }, 'f1')).toBe('pending');
  });
});

describe('clientPhotoErrorMessage', () => {
  const http = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  it('traduce los errores del backend y de la preparación', () => {
    expect(clientPhotoErrorMessage(new ProfilePhotoError('too small'))).toBe('too small');
    expect(clientPhotoErrorMessage(http(413))).toBe(PROFILE_PHOTO_MESSAGES.tooLarge);
    expect(clientPhotoErrorMessage(http(400, { code: 'Avatar.Animated', message: 'Animated images are not allowed.' }))).toBe(
      'Animated images are not allowed.',
    );
    expect(clientPhotoErrorMessage(http(400, { code: 'Customer.Archived', message: 'x' }))).toBe(
      "Archived clients can't have a photo.",
    );
    expect(clientPhotoErrorMessage(http(400))).toBe(CLIENT_PHOTO_FAILED_MESSAGE);
    expect(clientPhotoErrorMessage(http(404))).toBe("You can't change this client's photo.");
  });
});

describe('ClientPhotoStore', () => {
  let store: ClientPhotoStore;
  const picked = new File(['x'], 'client.png', { type: 'image/png' });
  const prepared = new File(['y'], 'client.jpg', { type: 'image/jpeg' });
  const prepare = vi.fn();
  const clients = {
    uploadAvatar: vi.fn(),
    deleteAvatar: vi.fn(),
    getById: vi.fn(),
    afterPhotoChange: vi.fn(),
  };
  /** Lo que responde el próximo GET del detalle (la lectura completa como un HTTP real). */
  let detail: unknown;

  beforeEach(() => {
    vi.useFakeTimers();
    detail = null;
    prepare.mockReset().mockResolvedValue(prepared);
    clients.uploadAvatar.mockReset().mockReturnValue(of({ fileId: 'f-new', status: 'processing' }));
    clients.deleteAvatar.mockReset().mockReturnValue(of(void 0));
    clients.getById.mockReset().mockImplementation(() => of(detail));
    clients.afterPhotoChange.mockReset();
    TestBed.configureTestingModule({
      providers: [
        ClientPhotoStore,
        { provide: ClientsStore, useValue: clients },
        { provide: PROFILE_PHOTO_PREPARER, useValue: prepare },
      ],
    });
    store = TestBed.inject(ClientPhotoStore);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  /** Avanza al siguiente tick del sondeo y responde el detalle del cliente. */
  async function pollTick(next: unknown, ms = PHOTO_POLL_INTERVAL_MS) {
    detail = next;
    await vi.advanceTimersByTimeAsync(ms);
  }

  it('prepara la imagen, la sube para ese cliente y sondea el detalle hasta confirmarla', async () => {
    const outcomes: unknown[] = [];
    store.upload('c1', picked).subscribe(o => outcomes.push(o));
    await vi.advanceTimersByTimeAsync(0);

    expect(prepare).toHaveBeenCalledWith(picked);
    expect(clients.uploadAvatar).toHaveBeenCalledWith('c1', prepared);
    expect(store.status()).toBe('processing');

    await pollTick({ avatarFileId: 'old', pendingAvatarFileId: 'f-new', avatarUploadStatus: 'processing' }, PHOTO_POLL_DELAY_MS);
    expect(outcomes).toEqual([]);

    await pollTick({ avatarFileId: 'f-new', pendingAvatarFileId: null, avatarUploadStatus: null });

    expect(outcomes).toEqual(['updated']);
    expect(clients.getById).toHaveBeenCalledWith('c1');
    expect(clients.afterPhotoChange).toHaveBeenCalledWith('c1');
    expect(store.status()).toBe('idle');
    expect(store.error()).toBeNull();
  });

  it('si el antivirus la descarta emite failed con el mensaje en línea y no toca el cache', async () => {
    const outcomes: unknown[] = [];
    store.upload('c1', picked).subscribe(o => outcomes.push(o));
    await vi.advanceTimersByTimeAsync(0);

    await pollTick({ avatarFileId: 'old', pendingAvatarFileId: null, avatarUploadStatus: 'failed' }, PHOTO_POLL_DELAY_MS);

    expect(outcomes).toEqual(['failed']);
    expect(store.error()).toBe(CLIENT_PHOTO_FAILED_MESSAGE);
    expect(clients.afterPhotoChange).not.toHaveBeenCalled();
  });

  it('sin veredicto tras los reintentos emite timeout', async () => {
    const outcomes: unknown[] = [];
    store.upload('c1', picked).subscribe(o => outcomes.push(o));
    await vi.advanceTimersByTimeAsync(0);

    await pollTick({ pendingAvatarFileId: 'f-new', avatarUploadStatus: 'processing' }, PHOTO_POLL_DELAY_MS);
    for (let i = 1; i < PHOTO_POLL_MAX_TRIES; i++) {
      await pollTick({ pendingAvatarFileId: 'f-new', avatarUploadStatus: 'processing' });
    }
    await vi.advanceTimersByTimeAsync(PHOTO_POLL_INTERVAL_MS * 2);

    expect(outcomes).toEqual(['timeout']);
    expect(store.status()).toBe('idle');
  });

  it('un 400 del backend queda en línea con su mensaje y se re-lanza', async () => {
    clients.uploadAvatar.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'Avatar.TooSmall', message: 'Too small.' } })),
    );
    const errors: unknown[] = [];
    store.upload('c1', picked).subscribe({ error: e => errors.push(e) });
    await vi.advanceTimersByTimeAsync(0);

    expect(errors).toHaveLength(1);
    expect(store.error()).toBe('Too small.');
    expect(store.status()).toBe('idle');
  });

  it('quitar la foto llama al DELETE del cliente', () => {
    let done = false;
    store.remove('c1').subscribe(() => (done = true));

    expect(clients.deleteAvatar).toHaveBeenCalledWith('c1');
    expect(done).toBe(true);
    expect(store.status()).toBe('idle');
  });

  it('retoma una foto en revisión y reset() corta el sondeo al cambiar de cliente', async () => {
    const outcomes: unknown[] = [];
    store.resume('c1', 'f-pending').subscribe(o => outcomes.push(o));
    expect(store.status()).toBe('processing');

    store.reset();
    await vi.advanceTimersByTimeAsync(PHOTO_POLL_DELAY_MS * 2);

    expect(clients.getById).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
    expect(store.status()).toBe('idle');
  });
});
