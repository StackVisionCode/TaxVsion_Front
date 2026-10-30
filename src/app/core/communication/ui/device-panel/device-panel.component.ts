import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { MediaDevicesService } from '../../media/media-devices.service';
import { MediaPolicyService } from '../../media/media-policy.service';
import { MeetingPipService } from '../../meeting-pip.service';
import { AudioProcessing } from '../../media/media-policy.model';
import { deviceLabel, permissionGuidance, permissionStatusLabel } from '../permission-guidance.util';

type ProcessingKey = keyof AudioProcessing;

/**
 * F4 (T-59 / D-46) — Panel "Devices" (drawer) común a la sala, el overlay de llamada y el mini-player.
 *
 *   <app-device-panel [isOpen]="devicesOpen()" (closed)="devicesOpen.set(false)"
 *     (microphoneChange)="meeting.swapMicrophone($event)" (cameraChange)="meeting.swapCamera($event)" />
 *
 * - Selectores de micrófono / cámara / altavoz (labels "Default microphone" hasta el primer permiso).
 *   Cambiar micro/cámara guarda la preferencia y EMITE el id: el anfitrión aplica el cambio en caliente
 *   (`swapMicrophone` / `swapCamera`). El altavoz se guarda en `MediaDevicesService.preferred` y el
 *   dueño del audio remoto lo aplica con `applySinkId` (el panel solo lo hace sonar con "Test speaker").
 * - Interruptores AEC / NS / AGC → `MediaPolicyService.updatePreferences` (se aplican en la próxima captura).
 * - Estado de permisos con guía por navegador y aviso "New microphone detected — Switch?".
 * Sin lógica de captura: usa los servicios de `media/` y emite acciones.
 */
@Component({
  selector: 'app-device-panel',
  imports: [DrawerComponent, SwitchComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './device-panel.component.html',
})
export class DevicePanelComponent {
  private readonly devices = inject(MediaDevicesService);
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly toast = inject(ToastService);
  private readonly pip = inject(MeetingPipService);

  /** F5 (D-43) — "pop out" automático al ocultar la pestaña (solo si el navegador soporta PiP). */
  readonly pipSupported = this.pip.supported;
  readonly autoPip = this.pip.autoPipEnabled;

  setAutoPip(enabled: boolean): void {
    this.pip.setAutoPip(enabled);
  }

  readonly isOpen = input(false);
  readonly showCamera = input(true);
  readonly showSpeaker = input(true);
  readonly closed = output<void>();
  readonly microphoneChange = output<string>();
  readonly cameraChange = output<string>();
  readonly speakerChange = output<string>();

  readonly microphones = this.devices.microphones;
  readonly cameras = this.devices.cameras;
  readonly speakers = this.devices.speakers;
  readonly supportsSinkId = this.devices.supportsSinkId;
  readonly newDevice = this.devices.newDevice;
  readonly waitingForPermission = this.devices.waitingForPermission;

  /** Id seleccionado: el activo en la sesión, si no el preferido, si no el primero. */
  readonly selectedMicrophoneId = computed(() => this.devices.activeMicrophoneId() ?? this.devices.preferred().audioInputId ?? this.microphones()[0]?.deviceId ?? '');
  readonly selectedCameraId = computed(() => this.devices.activeCameraId() ?? this.devices.preferred().videoInputId ?? this.cameras()[0]?.deviceId ?? '');
  readonly selectedSpeakerId = computed(() => this.devices.preferred().audioOutputId ?? this.speakers()[0]?.deviceId ?? '');

  readonly microphoneStatus = computed(() => permissionStatusLabel('microphone', this.devices.microphonePermission()));
  readonly cameraStatus = computed(() => permissionStatusLabel('camera', this.devices.cameraPermission()));
  readonly microphoneGuidance = computed(() => permissionGuidance('microphone', this.devices.microphonePermission(), userAgent()));
  readonly cameraGuidance = computed(() => permissionGuidance('camera', this.devices.cameraPermission(), userAgent()));
  readonly microphoneBlocked = computed(() => this.devices.microphonePermission() === 'denied');
  readonly cameraBlocked = computed(() => this.devices.cameraPermission() === 'denied');

  /** Procesamiento efectivo (preferencia del usuario o default de la oficina). */
  readonly processing = computed<AudioProcessing | null>(() => {
    const policy = this.mediaPolicy.policy();
    if (!policy) {
      return null;
    }
    const prefs = policy.preferences.audioProcessing;
    return {
      echoCancellation: prefs.echoCancellation ?? policy.audio.processing.echoCancellation,
      noiseSuppression: prefs.noiseSuppression ?? policy.audio.processing.noiseSuppression,
      autoGainControl: prefs.autoGainControl ?? policy.audio.processing.autoGainControl,
    };
  });
  readonly savingProcessing = signal<ProcessingKey | null>(null);
  readonly testingSpeaker = signal(false);

  readonly processingRows: readonly { key: ProcessingKey; label: string; hint: string }[] = [
    { key: 'echoCancellation', label: 'Echo cancellation', hint: 'Removes the sound of the other side coming back through your mic.' },
    { key: 'noiseSuppression', label: 'Noise suppression', hint: 'Filters keyboard, fans and background noise.' },
    { key: 'autoGainControl', label: 'Auto gain', hint: 'Keeps your voice at a steady volume.' },
  ];

  constructor() {
    // Al abrir: permisos + inventario (los labels solo llegan tras el primer permiso) y la política.
    effect(() => {
      if (this.isOpen()) {
        untracked(() => this.refresh());
      }
    });
  }

  labelFor(device: MediaDeviceInfo, index: number): string {
    return deviceLabel(device, index);
  }

  onMicrophoneChange(deviceId: string): void {
    if (!deviceId) {
      return;
    }
    this.devices.setPreferred('audioInputId', deviceId);
    this.microphoneChange.emit(deviceId);
  }

  onCameraChange(deviceId: string): void {
    if (!deviceId) {
      return;
    }
    this.devices.setPreferred('videoInputId', deviceId);
    this.cameraChange.emit(deviceId);
  }

  onSpeakerChange(deviceId: string): void {
    if (!deviceId) {
      return;
    }
    this.devices.setPreferred('audioOutputId', deviceId);
    this.speakerChange.emit(deviceId);
  }

  async testSpeaker(): Promise<void> {
    if (this.testingSpeaker()) {
      return;
    }
    this.testingSpeaker.set(true);
    const ok = await this.devices.testSpeaker(this.selectedSpeakerId() || null);
    this.testingSpeaker.set(false);
    if (!ok) {
      this.toast.error('Could not play the test sound.');
    }
  }

  async setProcessing(key: ProcessingKey, value: boolean): Promise<void> {
    this.savingProcessing.set(key);
    try {
      await this.mediaPolicy.updatePreferences({ [key]: value });
    } catch {
      this.toast.error('Could not save your audio settings.');
    } finally {
      this.savingProcessing.set(null);
    }
  }

  /** "New microphone detected — Switch?" */
  switchToNewDevice(): void {
    const notice = this.newDevice();
    if (!notice) {
      return;
    }
    if (notice.kind === 'microphone') {
      this.onMicrophoneChange(notice.device.deviceId);
    } else if (notice.kind === 'camera') {
      this.onCameraChange(notice.device.deviceId);
    } else {
      this.onSpeakerChange(notice.device.deviceId);
    }
    this.devices.dismissNewDevice();
  }

  dismissNewDevice(): void {
    this.devices.dismissNewDevice();
  }

  private refresh(): void {
    void this.devices.queryPermissions();
    void this.devices.refreshInventory();
    void this.mediaPolicy.ensureLoaded().catch(() => undefined);
  }
}

function userAgent(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : '';
}
