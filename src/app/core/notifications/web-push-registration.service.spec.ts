import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '@env/environment';
import { FIREBASE_MESSAGING_ADAPTER, FirebaseMessagingAdapter } from './firebase-messaging.adapter';
import { WebPushRegistrationService } from './web-push-registration.service';

describe('WebPushRegistrationService', () => {
  const originalFirebase = structuredClone(environment.firebase);
  const adapter: FirebaseMessagingAdapter = {
    isSupported: vi.fn(async () => true),
    getToken: vi.fn(async () => 'fcm-token'),
    deleteToken: vi.fn(async () => true),
  };

  beforeEach(() => {
    environment.firebase = configuredFirebase();
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FIREBASE_MESSAGING_ADAPTER, useValue: adapter },
      ],
    });
  });

  afterEach(() => {
    environment.firebase = structuredClone(originalFirebase);
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('never requests permission while the service is created or the session is synchronized', async () => {
    const service = TestBed.inject(WebPushRegistrationService);

    await service.syncForSession('user-1', 'tenant-1');

    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('requests permission only after the explicit enable action', async () => {
    const requestPermission = vi.mocked(Notification.requestPermission);
    requestPermission.mockResolvedValue('denied');
    const service = TestBed.inject(WebPushRegistrationService);

    expect(await service.enable('user-1', 'tenant-1')).toBe(false);

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(service.status()).toBe('denied');
  });

  it('revokes the backend registration before deleting the Firebase token', async () => {
    localStorage.setItem(
      'taxproffice_push_registration',
      JSON.stringify({ tokenId: 'token-id', userId: 'user-1', tenantId: 'tenant-1' }),
    );
    const service = TestBed.inject(WebPushRegistrationService);
    const http = TestBed.inject(HttpTestingController);

    const pending = service.revokeCurrent();
    const request = http.expectOne((candidate) => candidate.url.endsWith('/notifications/push/devices/token-id'));
    expect(request.request.method).toBe('DELETE');
    expect(adapter.deleteToken).not.toHaveBeenCalled();

    request.flush(null);
    await pending;

    expect(adapter.deleteToken).toHaveBeenCalledOnce();
    expect(localStorage.getItem('taxproffice_push_registration')).toBeNull();
  });

  it('does not load Firebase on logout when this browser never registered a token', async () => {
    const service = TestBed.inject(WebPushRegistrationService);

    await service.revokeCurrent();

    expect(adapter.deleteToken).not.toHaveBeenCalled();
    TestBed.inject(HttpTestingController).expectNone(() => true);
  });

  it('undoes a registration that finishes after the logout', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    vi.stubGlobal('navigator', {
      ...navigator,
      serviceWorker: { register: vi.fn(async () => ({}) as ServiceWorkerRegistration) },
    });
    const service = TestBed.inject(WebPushRegistrationService);
    const http = TestBed.inject(HttpTestingController);

    const syncing = service.syncForSession('user-1', 'tenant-1');
    let registration!: ReturnType<HttpTestingController['expectOne']>;
    await vi.waitFor(() => {
      registration = http.expectOne((request) => request.method === 'POST');
    });
    await service.revokeCurrent();
    registration.flush({ id: 'late-token', platform: 'Web', wasReactivated: false });

    let cleanup!: ReturnType<HttpTestingController['expectOne']>;
    await vi.waitFor(() => {
      cleanup = http.expectOne(
        (request) => request.method === 'DELETE' && request.url.endsWith('/late-token'),
      );
    });
    cleanup.flush(null);
    await syncing;

    expect(localStorage.getItem('taxproffice_push_registration')).toBeNull();
    expect(service.status()).not.toBe('enabled');
  });
});

function configuredFirebase() {
  return {
    config: {
      apiKey: 'api-key',
      authDomain: 'project.firebaseapp.com',
      projectId: 'project',
      storageBucket: 'project.appspot.com',
      messagingSenderId: '123',
      appId: 'app-id',
    },
    vapidKey: 'vapid-key',
  };
}
