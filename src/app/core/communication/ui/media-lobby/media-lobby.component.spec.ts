import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LobbyJoinOptions, MediaLobbyComponent } from './media-lobby.component';
import { MediaDevicesService, MediaPermissionState } from '../../media/media-devices.service';
import { MediaPolicyService } from '../../media/media-policy.service';
import { MediaAccessError } from '../../media/media-errors';
import { fakeMediaPolicyService, mediaPolicyFixture } from '../../media/testing/media-policy.fixture';

@Component({
  imports: [MediaLobbyComponent],
  template: `<app-media-lobby meetingTitle="Weekly sync" (join)="joins.push($event)" (cancel)="onCancel()" />`,
})
class HostComponent {
  readonly joins: LobbyJoinOptions[] = [];
  cancels = 0;
  onCancel(): void {
    this.cancels++;
  }
}

class FakeTrack {
  readyState = 'live';
  readonly stop = vi.fn(() => (this.readyState = 'ended'));
  constructor(readonly kind: 'audio' | 'video') {}
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  addEventListener(): void {}
  removeEventListener(): void {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter(t => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter(t => t.kind === 'video');
  }
}

function fakeDevices() {
  return {
    microphones: signal<MediaDeviceInfo[]>([]),
    cameras: signal<MediaDeviceInfo[]>([]),
    speakers: signal<MediaDeviceInfo[]>([]),
    microphonePermission: signal<MediaPermissionState>('prompt'),
    cameraPermission: signal<MediaPermissionState>('prompt'),
    preferred: signal({ audioInputId: null, videoInputId: null, audioOutputId: null }),
    waitingForPermission: signal(false),
    supportsSinkId: false,
    isSupported: () => true,
    queryPermissions: vi.fn().mockResolvedValue(undefined),
    refreshInventory: vi.fn().mockResolvedValue(undefined),
    setPreferred: vi.fn(),
    testSpeaker: vi.fn().mockResolvedValue(true),
    getUserMedia: vi.fn(),
  };
}

describe('MediaLobbyComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function setup(policy = mediaPolicyFixture(), devices = fakeDevices()) {
    const mediaPolicy = fakeMediaPolicyService(policy);
    const updatePreferences = vi.fn().mockResolvedValue(policy);
    (mediaPolicy as { updatePreferences: unknown }).updatePreferences = updatePreferences;
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: MediaDevicesService, useValue: devices },
        { provide: MediaPolicyService, useValue: mediaPolicy },
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0)); // init(): política → permisos → captura
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (action: string) => el.querySelector(`[data-action="${action}"]`) as HTMLButtonElement;
    return { fixture, host: fixture.componentInstance, el, button, devices, updatePreferences };
  }

  it('captura la vista previa con audio y cámara y la libera antes de entrar', async () => {
    const devices = fakeDevices();
    const stream = new FakeStream([new FakeTrack('audio'), new FakeTrack('video')]);
    devices.getUserMedia.mockResolvedValue(stream);
    const { host, button } = await setup(mediaPolicyFixture(), devices);
    expect(devices.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ width: { ideal: 1280 } }) }), 'camera');

    button('join').click();
    expect(stream.tracks.every(t => t.stop.mock.calls.length === 1)).toBe(true);
    expect(host.joins).toEqual([{ audio: true, video: true }]);
  });

  it('los defaults vienen de las preferencias: joinMuted + joinCameraOff → join con {audio:false, video:false} sin pedir cámara', async () => {
    const policy = mediaPolicyFixture();
    policy.preferences = { ...policy.preferences, joinMuted: true, joinCameraOff: true };
    const devices = fakeDevices();
    devices.getUserMedia.mockResolvedValue(new FakeStream([new FakeTrack('audio')]));
    const { host, button, el, updatePreferences } = await setup(policy, devices);
    expect(devices.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: false }), 'microphone');
    expect(el.textContent).toContain('Camera off');

    button('join').click();
    expect(host.joins).toEqual([{ audio: false, video: false }]);
    expect(updatePreferences).not.toHaveBeenCalled(); // sin cambios, no se re-guardan
  });

  it('cambiar un interruptor se guarda como preferencia al entrar', async () => {
    const devices = fakeDevices();
    devices.getUserMedia.mockResolvedValue(new FakeStream([new FakeTrack('audio'), new FakeTrack('video')]));
    const { fixture, host, el, button, updatePreferences } = await setup(mediaPolicyFixture(), devices);
    const switches = el.querySelectorAll('[role="switch"]');
    (switches[0] as HTMLButtonElement).click(); // Join muted
    fixture.detectChanges();
    button('join').click();
    expect(host.joins).toEqual([{ audio: false, video: true }]);
    expect(updatePreferences).toHaveBeenCalledWith({ joinMuted: true, joinCameraOff: false });
  });

  it('con la cámara bloqueada cae a solo audio, explica el bloqueo y entra sin video', async () => {
    const devices = fakeDevices();
    devices.getUserMedia
      .mockRejectedValueOnce(new MediaAccessError('NotAllowed', 'camera', 'The camera is blocked in the browser.', 'Allow camera access and try again.'))
      .mockResolvedValueOnce(new FakeStream([new FakeTrack('audio')]));
    const { host, el, button } = await setup(mediaPolicyFixture(), devices);
    expect(el.textContent).toContain('The camera is blocked in the browser.');
    expect(el.textContent).toContain('Allow camera access and try again.');
    button('join').click();
    expect(host.joins).toEqual([{ audio: true, video: false }]);
  });

  it('Cancel libera la vista previa y avisa', async () => {
    const devices = fakeDevices();
    const stream = new FakeStream([new FakeTrack('audio')]);
    devices.getUserMedia.mockResolvedValue(stream);
    const { host, button } = await setup(mediaPolicyFixture(), devices);
    button('cancel').click();
    expect(host.cancels).toBe(1);
    expect(stream.tracks[0].stop).toHaveBeenCalled();
  });
});
