import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { SrcObjectDirective } from '../../src-object.directive';
import { MediaDevicesService } from '../../media/media-devices.service';
import { MediaPolicyService } from '../../media/media-policy.service';
import { MediaPolicyDto } from '../../media/media-policy.model';
import { MediaAccessError } from '../../media/media-errors';
import { rmsLevel } from '../../active-speaker.util';
import { deviceLabel, permissionGuidance, permissionStatusLabel } from '../permission-guidance.util';

/** Lo que el lobby decide para `ActiveMeetingService.join(id, title, { audio, video })`. */
export interface LobbyJoinOptions {
  audio: boolean;
  video: boolean;
}

/** Cada cuánto se lee el medidor (ms) y tamaño de la FFT (resolución del RMS). */
const METER_TICK_MS = 100;
const METER_FFT_SIZE = 512;

/**
 * F4 (D-45) — Lobby previo a entrar a una reunión (cargar con `@defer`): vista previa espejada, medidor
 * de nivel (`AnalyserNode` + `rmsLevel`), selectores de dispositivos, "Test speaker", interruptores
 * "Join muted" / "Join with camera off" (defaults de `policy.preferences`) y estado de permisos con guía.
 *
 *   @defer { <app-media-lobby [meetingTitle]="title" (join)="meeting.join(id, title, $event)" (cancel)="…" /> }
 *
 * La vista previa es SOLO del lobby: se libera antes de emitir `join` (la sesión real captura de nuevo)
 * y al destruir el componente. Las llamadas entrantes no pasan por aquí (preferencias al aceptar).
 */
@Component({
  selector: 'app-media-lobby',
  imports: [SwitchComponent, InfinityLoaderComponent, SrcObjectDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './media-lobby.component.html',
})
export class MediaLobbyComponent implements OnInit {
  private readonly devices = inject(MediaDevicesService);
  private readonly mediaPolicy = inject(MediaPolicyService);

  readonly meetingTitle = input('');
  /** F6 — false para el invitado externo: no tiene JWT para `PUT /communication/preferences`. */
  readonly savePreferences = input(true);
  readonly join = output<LobbyJoinOptions>();
  readonly cancel = output<void>();

  readonly policy = signal<MediaPolicyDto | null>(null);
  readonly policyError = signal(false);
  readonly joinMuted = signal(false);
  readonly cameraOff = signal(false);
  readonly previewStream = signal<MediaStream | null>(null);
  /** Nivel RMS del micrófono (0–1) para el medidor. */
  readonly level = signal(0);
  readonly audioError = signal<MediaAccessError | null>(null);
  readonly videoError = signal<MediaAccessError | null>(null);
  readonly capturing = signal(false);
  readonly testingSpeaker = signal(false);

  readonly microphones = this.devices.microphones;
  readonly cameras = this.devices.cameras;
  readonly speakers = this.devices.speakers;
  readonly supportsSinkId = this.devices.supportsSinkId;
  readonly waitingForPermission = this.devices.waitingForPermission;
  readonly selectedMicrophoneId = computed(() => this.devices.preferred().audioInputId ?? this.microphones()[0]?.deviceId ?? '');
  readonly selectedCameraId = computed(() => this.devices.preferred().videoInputId ?? this.cameras()[0]?.deviceId ?? '');
  readonly selectedSpeakerId = computed(() => this.devices.preferred().audioOutputId ?? this.speakers()[0]?.deviceId ?? '');

  readonly hasMicrophone = computed(() => !!this.previewStream()?.getAudioTracks().length);
  readonly hasCamera = computed(() => !this.cameraOff() && !!this.previewStream()?.getVideoTracks().length);
  readonly microphoneStatus = computed(() => permissionStatusLabel('microphone', this.devices.microphonePermission()));
  readonly cameraStatus = computed(() => permissionStatusLabel('camera', this.devices.cameraPermission()));
  readonly microphoneGuidance = computed(() => this.audioError()?.guidance ?? permissionGuidance('microphone', this.devices.microphonePermission(), userAgent()));
  readonly cameraGuidance = computed(() => this.videoError()?.guidance ?? permissionGuidance('camera', this.devices.cameraPermission(), userAgent()));
  /** Ancho del medidor (%), con un piso visible cuando hay micro. */
  readonly meterPct = computed(() => (this.hasMicrophone() ? Math.min(100, Math.round(this.level() * 300)) : 0));
  readonly canJoin = computed(() => !!this.policy() && !this.capturing());

  private meterCtx: AudioContext | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private captureSeq = 0;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.releasePreview();
    });
  }

  ngOnInit(): void {
    void this.init();
  }

  labelFor(device: MediaDeviceInfo, index: number): string {
    return deviceLabel(device, index);
  }

  setJoinMuted(value: boolean): void {
    this.joinMuted.set(value);
  }

  setCameraOff(value: boolean): void {
    this.cameraOff.set(value);
    void this.startPreview();
  }

  onMicrophoneChange(deviceId: string): void {
    if (deviceId) {
      this.devices.setPreferred('audioInputId', deviceId);
      void this.startPreview();
    }
  }

  onCameraChange(deviceId: string): void {
    if (deviceId) {
      this.devices.setPreferred('videoInputId', deviceId);
      void this.startPreview();
    }
  }

  onSpeakerChange(deviceId: string): void {
    if (deviceId) {
      this.devices.setPreferred('audioOutputId', deviceId);
    }
  }

  async testSpeaker(): Promise<void> {
    if (this.testingSpeaker()) {
      return;
    }
    this.testingSpeaker.set(true);
    await this.devices.testSpeaker(this.selectedSpeakerId() || null);
    this.testingSpeaker.set(false);
  }

  /** Libera la vista previa y entrega la decisión (audio = no muteado; video = cámara encendida y disponible). */
  confirmJoin(): void {
    const policy = this.policy();
    if (!policy) {
      return;
    }
    const options: LobbyJoinOptions = { audio: !this.joinMuted(), video: !this.cameraOff() && !this.videoError() };
    // Los interruptores son la preferencia del usuario: se guardan si cambiaron (best-effort).
    if (this.savePreferences() && (policy.preferences.joinMuted !== this.joinMuted() || policy.preferences.joinCameraOff !== this.cameraOff())) {
      void this.mediaPolicy.updatePreferences({ joinMuted: this.joinMuted(), joinCameraOff: this.cameraOff() }).catch(() => undefined);
    }
    this.releasePreview();
    this.join.emit(options);
  }

  cancelJoin(): void {
    this.releasePreview();
    this.cancel.emit();
  }

  // ---------- internos ----------

  private async init(): Promise<void> {
    try {
      const policy = await this.mediaPolicy.ensureLoaded();
      if (this.destroyed) {
        return;
      }
      this.policy.set(policy);
      this.joinMuted.set(policy.preferences.joinMuted);
      this.cameraOff.set(policy.preferences.joinCameraOff || policy.preferences.preferAudioOnly);
    } catch {
      this.policyError.set(true);
      return;
    }
    await this.devices.queryPermissions();
    await this.startPreview();
    await this.devices.refreshInventory(); // tras el permiso llegan los labels
  }

  /** Captura (o re-captura) la vista previa con los dispositivos preferidos. */
  private async startPreview(): Promise<void> {
    const seq = ++this.captureSeq;
    this.releasePreview();
    if (!this.devices.isSupported()) {
      this.audioError.set(new MediaAccessError('Unsupported', 'microphone', 'This browser cannot access the microphone.'));
      return;
    }
    this.capturing.set(true);
    this.audioError.set(null);
    this.videoError.set(null);
    const wantVideo = !this.cameraOff();
    let stream: MediaStream | null = null;
    try {
      stream = await this.devices.getUserMedia({ audio: this.audioConstraints(), video: wantVideo ? this.cameraConstraints() : false }, wantVideo ? 'camera' : 'microphone');
    } catch (err) {
      if (wantVideo) {
        this.videoError.set(err as MediaAccessError);
        try {
          stream = await this.devices.getUserMedia({ audio: this.audioConstraints(), video: false }, 'microphone');
        } catch (err2) {
          this.audioError.set(err2 as MediaAccessError);
        }
      } else {
        this.audioError.set(err as MediaAccessError);
      }
    }
    if (seq !== this.captureSeq || this.destroyed) {
      stream?.getTracks().forEach(t => t.stop()); // llegó tarde: otra captura ya manda
      return;
    }
    this.capturing.set(false);
    this.previewStream.set(stream);
    this.startMeter(stream);
  }

  private releasePreview(): void {
    this.stopMeter();
    this.previewStream()?.getTracks().forEach(t => t.stop());
    this.previewStream.set(null);
    this.level.set(0);
  }

  private startMeter(stream: MediaStream | null): void {
    const track = stream?.getAudioTracks()[0];
    if (!track || typeof AudioContext === 'undefined') {
      return;
    }
    try {
      this.meterCtx = new AudioContext();
      void this.meterCtx.resume().catch(() => undefined);
      const analyser = this.meterCtx.createAnalyser();
      analyser.fftSize = METER_FFT_SIZE;
      this.meterCtx.createMediaStreamSource(new MediaStream([track])).connect(analyser); // no a destination: solo medir
      const buffer = new Uint8Array(analyser.fftSize);
      this.meterTimer = setInterval(() => {
        analyser.getByteTimeDomainData(buffer);
        this.level.set(rmsLevel(buffer));
      }, METER_TICK_MS);
    } catch {
      this.stopMeter(); // sin WebAudio: vista previa sin medidor
    }
  }

  private stopMeter(): void {
    if (this.meterTimer) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
    void this.meterCtx?.close().catch(() => undefined);
    this.meterCtx = null;
  }

  private audioConstraints(): MediaTrackConstraints {
    const id = this.devices.preferred().audioInputId;
    const processing = this.policy()?.audio.processing;
    return { ...(id ? { deviceId: { exact: id } } : {}), ...(processing ?? {}) };
  }

  private cameraConstraints(): MediaTrackConstraints {
    const id = this.devices.preferred().videoInputId;
    const camera = this.policy()?.video.camera;
    return {
      ...(id ? { deviceId: { exact: id } } : {}),
      ...(camera ? { width: { ideal: camera.maxWidth }, height: { ideal: camera.maxHeight }, frameRate: { ideal: camera.maxFps } } : {}),
    };
  }
}

function userAgent(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : '';
}
