import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, describe, expect, it } from 'vitest';
import { PermissionService } from '@core/auth/permission.service';
import { AuthService } from '@core/auth/auth.service';
import { ActiveCallService } from '../active-call.service';
import { MediaPolicyService } from '../media/media-policy.service';
import { fakeMediaPolicyService } from '../media/testing/media-policy.fixture';
import { CallOverlayComponent } from './call-overlay.component';

/** Doble del ActiveCallService: cada signal que pida el overlay existe (null/false por defecto). */
function fakeCall(overrides: Record<string, unknown>) {
  const known: Record<string, unknown> = {
    phase: signal('outgoing'),
    kind: signal('Audio'),
    recordingState: signal('Idle'),
    connectionQuality: signal('Good'),
    ...overrides,
  };
  return new Proxy(known, {
    get: (target, key: string) => {
      if (!(key in target)) {
        target[key] = signal(null);
      }
      return target[key];
    },
  });
}

function render(overrides: Record<string, unknown>) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ActiveCallService, useValue: fakeCall(overrides) },
      { provide: PermissionService, useValue: { has: () => false, isActor: () => false } },
      { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
      { provide: MediaPolicyService, useValue: fakeMediaPolicyService() },
    ],
  });
  const fixture = TestBed.createComponent(CallOverlayComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('CallOverlayComponent — avatar del par', () => {
  it('muestra la foto del par con app-avatar', () => {
    const el = render({
      peerUserId: signal('u-ana'),
      peerDisplayName: signal('Ana Pérez'),
      peerAvatarFileId: signal('f-ana'),
    });
    const img = el.querySelector('app-avatar img');
    expect(img?.getAttribute('src')).toMatch(/\/storage\/avatars\/f-ana$/);
    expect(img?.getAttribute('alt')).toBe('Ana Pérez');
  });

  it('sin foto cae a las iniciales del par', () => {
    const el = render({
      peerUserId: signal('u-ana'),
      peerDisplayName: signal('Ana Pérez'),
      peerAvatarFileId: signal(null),
    });
    const avatar = el.querySelector('app-avatar') as HTMLElement;
    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar.textContent).toContain('AP');
  });
});

describe('CallOverlayComponent — F4', () => {
  afterEach(() => document.querySelectorAll('.modal-backdrop').forEach(el => el.remove()));

  it('T-58: entrante durante una reunión muestra "In a meeting" con solo Decline (sin botón Accept)', () => {
    const el = render({
      phase: signal('incoming'),
      peerDisplayName: signal('Ana Pérez'),
      incomingBlockedByMeeting: signal(true),
    });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('In a meeting');
    expect(dialog.querySelector('[data-action="decline-in-meeting"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Accept call"]')).toBeNull();
  });

  it('reproduce el audio de la pantalla del par en su propio <audio> mientras comparte', () => {
    const el = render({ phase: signal('active'), kind: signal('Video'), peerScreenSharing: signal(true), peerCameraOn: signal(false) });
    expect(el.querySelector('audio[data-role="screen-audio"]')).not.toBeNull();
    expect(el.querySelectorAll('audio').length).toBe(2);
  });

  it('muestra el badge propio y el del par, y el aviso "Call ends in …"', () => {
    const el = render({
      phase: signal('active'),
      kind: signal('Audio'),
      connectionQuality: signal('Good'),
      peerQuality: signal('Poor'),
      reconnecting: signal(false),
      durationWarning: signal({ callId: 'c1', remainingSeconds: 300, endsAtUtc: '' }),
    });
    expect(el.querySelector('[data-role="own-quality"] [role="img"]')?.getAttribute('aria-label')).toBe('Good connection');
    expect(el.querySelector('[data-role="peer-quality"] [role="img"]')?.getAttribute('aria-label')).toBe('Poor connection');
    expect(el.textContent).toContain('Call ends in 5 minutes');
  });
});
