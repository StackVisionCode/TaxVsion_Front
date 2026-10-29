import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { PermissionService } from '@core/auth/permission.service';
import { AuthService } from '@core/auth/auth.service';
import { ActiveCallService } from '../active-call.service';
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
      { provide: PermissionService, useValue: { has: () => false } },
      { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
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
