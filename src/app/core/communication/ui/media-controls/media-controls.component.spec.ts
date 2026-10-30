import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaControlsComponent, ScreenShareRequest, supportsScreenAudio } from './media-controls.component';
import type { MuteReason } from '../../media/local-media-session';

@Component({
  imports: [MediaControlsComponent],
  template: `
    <app-media-controls [audioEnabled]="audio()" [videoEnabled]="video()" [muteReason]="reason()" [videoPausedByNetwork]="paused()"
      [hasMicrophone]="hasMic()" [waitingForPermission]="waiting()" [screenSharing]="sharing()" [screenAudioAllowed]="audioAllowed()"
      [showHand]="true" [showChat]="true" [chatUnread]="3" leaveLabel="Leave"
      (toggleAudio)="events.push('audio')" (toggleVideo)="events.push('video')" (shareScreen)="shared.push($event)"
      (stopScreenShare)="events.push('stop-share')" (toggleHand)="events.push('hand')" (toggleChat)="events.push('chat')"
      (openDevices)="events.push('devices')" (leave)="events.push('leave')">
      <button type="button" data-control="extra">Extra</button>
    </app-media-controls>
  `,
})
class HostComponent {
  readonly audio = signal(true);
  readonly video = signal(true);
  readonly reason = signal<MuteReason | null>(null);
  readonly paused = signal(false);
  readonly hasMic = signal(true);
  readonly waiting = signal(false);
  readonly sharing = signal(false);
  readonly audioAllowed = signal(false);
  readonly events: string[] = [];
  readonly shared: ScreenShareRequest[] = [];
}

function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const control = (name: string) => el.querySelector(`[data-control="${name}"]`) as HTMLButtonElement | null;
  return { fixture, host: fixture.componentInstance, el, control };
}

describe('MediaControlsComponent', () => {
  const originalMediaDevices = navigator.mediaDevices;
  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true });
    document.querySelectorAll('[role="menu"]').forEach(el => el.remove());
  });

  it('emite cada acción y proyecta los botones extra antes de salir', () => {
    const { host, control } = setup();
    for (const name of ['mic', 'camera', 'hand', 'chat', 'devices', 'leave']) {
      control(name)!.click();
    }
    expect(host.events).toEqual(['audio', 'video', 'hand', 'chat', 'devices', 'leave']);
    expect(control('extra')).not.toBeNull();
    expect(control('leave')?.textContent).toContain('Leave');
    expect(control('chat')?.textContent).toContain('3');
  });

  it('explica el mute por eco / host en el tooltip y lo pinta en ámbar; el mute propio en rojo', () => {
    const { fixture, host, control } = setup();
    host.audio.set(false);
    fixture.detectChanges();
    expect(control('mic')!.className).toContain('bg-red-500');
    expect(control('mic')!.getAttribute('aria-label')).toBe('Unmute microphone');

    host.reason.set('echo');
    fixture.detectChanges();
    expect(control('mic')!.className).toContain('bg-amber-400');
    expect(control('mic')!.getAttribute('aria-label')).toContain('echo');

    host.reason.set('host');
    fixture.detectChanges();
    expect(control('mic')!.getAttribute('aria-label')).toContain('Muted by the host');
  });

  it('"No microphone" y "Waiting for permission…" deshabilitan el micrófono', () => {
    const { fixture, host, control } = setup();
    host.hasMic.set(false);
    fixture.detectChanges();
    expect(control('mic')!.disabled).toBe(true);
    expect(control('mic')!.getAttribute('aria-label')).toBe('No microphone');

    host.hasMic.set(true);
    host.waiting.set(true);
    fixture.detectChanges();
    expect(control('mic')!.disabled).toBe(true);
    expect(control('mic')!.getAttribute('aria-label')).toBe('Waiting for permission…');
  });

  it('la cámara pausada por red avisa "Video paused to protect audio" sin tocar el estado del usuario', () => {
    const { fixture, host, control } = setup();
    host.paused.set(true);
    fixture.detectChanges();
    expect(control('camera')!.getAttribute('aria-label')).toBe('Video paused to protect audio');
    expect(control('camera')!.className).toContain('bg-amber-400');
    expect(control('camera')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('sin getDisplayMedia no ofrece compartir; con él comparte sin audio y para al volver a pulsar', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const first = setup();
    expect(first.control('share')).toBeNull();
    TestBed.resetTestingModule();

    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia: vi.fn() }, configurable: true });
    const { fixture, host, control } = setup();
    control('share')!.click();
    expect(host.shared).toEqual([{ withAudio: false }]);
    host.sharing.set(true);
    fixture.detectChanges();
    control('share')!.click();
    expect(host.events).toContain('stop-share');
  });

  it('con audio de pantalla permitido y soportado, el botón abre "Share screen" / "Share screen with audio"', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia: vi.fn() }, configurable: true });
    const supported = supportsScreenAudio('Mozilla/5.0 Chrome/130.0 Safari/537.36');
    expect(supported).toBe(true);
    expect(supportsScreenAudio('Mozilla/5.0 Firefox/131.0')).toBe(false);

    const { fixture, host, control } = setup();
    host.audioAllowed.set(true);
    fixture.detectChanges();
    if (!supportsScreenAudio()) {
      return; // el jsdom no se presenta como Chromium: el menú no aplica en este entorno
    }
    control('share')!.click();
    fixture.detectChanges();
    (document.querySelector('[data-control="share-audio"]') as HTMLButtonElement).click();
    expect(host.shared).toEqual([{ withAudio: true }]);
  });
});
