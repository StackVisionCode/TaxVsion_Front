import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '@shared/ui/toast/toast.service';
import { DevicePanelComponent } from './device-panel.component';
import { MediaDevicesService, MediaPermissionState } from '../../media/media-devices.service';
import { MediaPolicyService } from '../../media/media-policy.service';
import { fakeMediaPolicyService, mediaPolicyFixture } from '../../media/testing/media-policy.fixture';

@Component({
  imports: [DevicePanelComponent],
  template: `<app-device-panel [isOpen]="open()" (microphoneChange)="mics.push($event)" (cameraChange)="cams.push($event)" (speakerChange)="spk.push($event)" />`,
})
class HostComponent {
  readonly open = signal(true);
  readonly mics: string[] = [];
  readonly cams: string[] = [];
  readonly spk: string[] = [];
}

function device(kind: MediaDeviceKind, deviceId: string, label = ''): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: 'g', toJSON: () => ({}) };
}

function fakeDevices() {
  return {
    microphones: signal<MediaDeviceInfo[]>([device('audioinput', 'default'), device('audioinput', 'mic-2', 'USB Mic')]),
    cameras: signal<MediaDeviceInfo[]>([device('videoinput', 'cam-1')]),
    speakers: signal<MediaDeviceInfo[]>([device('audiooutput', 'spk-1', 'Headphones')]),
    microphonePermission: signal<MediaPermissionState>('denied'),
    cameraPermission: signal<MediaPermissionState>('granted'),
    preferred: signal({ audioInputId: null, videoInputId: null, audioOutputId: null }),
    activeMicrophoneId: signal<string | null>(null),
    activeCameraId: signal<string | null>(null),
    waitingForPermission: signal(false),
    newDevice: signal<{ kind: 'microphone'; device: MediaDeviceInfo } | null>(null),
    supportsSinkId: true,
    queryPermissions: vi.fn().mockResolvedValue(undefined),
    refreshInventory: vi.fn().mockResolvedValue(undefined),
    setPreferred: vi.fn(),
    testSpeaker: vi.fn().mockResolvedValue(true),
    dismissNewDevice: vi.fn(),
  };
}

const drawer = () => document.querySelector('[role="dialog"]') as HTMLElement | null;

describe('DevicePanelComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.querySelectorAll('[role="dialog"]').forEach(el => el.parentElement?.remove());
  });

  function setup(devices = fakeDevices()) {
    const mediaPolicy = fakeMediaPolicyService(mediaPolicyFixture());
    const updatePreferences = vi.fn().mockResolvedValue(mediaPolicyFixture());
    (mediaPolicy as { updatePreferences: unknown }).updatePreferences = updatePreferences;
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: MediaDevicesService, useValue: devices },
        { provide: MediaPolicyService, useValue: mediaPolicy },
        { provide: ToastService, useValue: { error: vi.fn(), info: vi.fn(), success: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return { fixture, host: fixture.componentInstance, devices, updatePreferences };
  }

  it('al abrir pide permisos e inventario, etiqueta "Default microphone" y muestra el bloqueo con guía', () => {
    const { devices } = setup();
    expect(devices.queryPermissions).toHaveBeenCalled();
    expect(devices.refreshInventory).toHaveBeenCalled();
    const text = drawer()!.textContent ?? '';
    expect(text).toContain('Default microphone');
    expect(text).toContain('USB Mic');
    expect(text).toContain('Microphone blocked in the browser');
    expect(text).toContain('Camera allowed');
    expect((drawer()!.querySelector('#device-mic') as HTMLSelectElement).disabled).toBe(true);
  });

  it('cambiar un dispositivo guarda la preferencia y emite el id para el cambio en caliente', () => {
    const { host, devices } = setup();
    const cam = drawer()!.querySelector('#device-camera') as HTMLSelectElement;
    cam.value = 'cam-1';
    cam.dispatchEvent(new Event('change'));
    expect(devices.setPreferred).toHaveBeenCalledWith('videoInputId', 'cam-1');
    expect(host.cams).toEqual(['cam-1']);

    const spk = drawer()!.querySelector('#device-speaker') as HTMLSelectElement;
    spk.value = 'spk-1';
    spk.dispatchEvent(new Event('change'));
    expect(devices.setPreferred).toHaveBeenCalledWith('audioOutputId', 'spk-1');
    expect(host.spk).toEqual(['spk-1']);
  });

  it('"Test speaker" suena por el altavoz elegido y los interruptores guardan preferencias', async () => {
    const { fixture, devices, updatePreferences } = setup();
    const test = [...drawer()!.querySelectorAll('button')].find(b => b.textContent?.includes('Test speaker'))!;
    test.click();
    await fixture.whenStable();
    expect(devices.testSpeaker).toHaveBeenCalledWith('spk-1');

    const switches = drawer()!.querySelectorAll('[role="switch"]');
    expect(switches.length).toBe(3);
    (switches[1] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(updatePreferences).toHaveBeenCalledWith({ noiseSuppression: false });
  });

  it('"New microphone detected — Switch?" cambia al nuevo y descarta el aviso', () => {
    const devices = fakeDevices();
    devices.newDevice.set({ kind: 'microphone', device: device('audioinput', 'mic-new', 'Blue Yeti') });
    const { host } = setup(devices);
    expect(drawer()!.textContent).toContain('New microphone detected — Switch?');
    [...drawer()!.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Switch')!.click();
    expect(host.mics).toEqual(['mic-new']);
    expect(devices.dismissNewDevice).toHaveBeenCalled();
  });
});
