import { FullscreenFrameDirective } from '../ui/fullscreen-frame/fullscreen-frame.directive';
import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, OnDestroy, computed, effect, inject, signal, viewChildren } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';
import { CommonModule } from '@angular/common';
import { AuthService } from '@core/auth/auth.service';
import { ActiveCallService } from '../active-call.service';
import { SrcObjectDirective } from '../src-object.directive';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { AvatarUrlService } from '@core/profile-photo/avatar-url';
import { MediaControlsComponent, ScreenShareRequest } from '../ui/media-controls/media-controls.component';
import { QualityBadgeComponent } from '../ui/quality-badge/quality-badge.component';
import { DevicePanelComponent } from '../ui/device-panel/device-panel.component';
import { RecordingConsentComponent } from '../ui/recording-consent/recording-consent.component';
import { RecordingBadgeComponent } from '../ui/recording-badge/recording-badge.component';
import { isRecordingBusy } from '../recording-status';
import { MediaDevicesService } from '../media/media-devices.service';
import { MediaPolicyService } from '../media/media-policy.service';
import { durationWarningLabel } from '../meeting-clock.util';

/** actorTypes de staff: ven las cifras del badge de calidad (D-39). */
const STAFF_ACTORS = ['TenantEmployee', 'TenantAdmin', 'PlatformAdmin'] as const;

/**
 * Overlay global de la llamada 1:1 activa. Montado una vez en el shell autenticado
 * para aparecer en cualquier página (entrante, saliente o en curso). Solo LEE los
 * signals de ActiveCallService.
 *  - Audio: tarjeta compacta; el `<audio>` reproduce al remoto.
 *  - Video: stage grande con video remoto + PiP local + controles.
 * F4: controles comunes (`app-media-controls`), badge de calidad propio y del par, aviso de tope de
 * minutos, panel Devices (cambios en caliente), consentimiento común y audio de la pantalla remota.
 * T-58: llamada entrante durante una reunión → modal "In a meeting" (solo Decline).
 */
@Component({
  selector: 'app-call-overlay',
  imports: [
    InfinityLoaderComponent,
    CommonModule,
    SrcObjectDirective,
    AvatarComponent,
    ModalComponent,
    MediaControlsComponent,
    QualityBadgeComponent,
    DevicePanelComponent,
    RecordingConsentComponent,
    RecordingBadgeComponent,
    FullscreenFrameDirective,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './call-overlay.component.html',
})
export class CallOverlayComponent implements OnDestroy {
  private readonly perms = inject(PermissionService);
  private readonly call = inject(ActiveCallService);
  private readonly auth = inject(AuthService);
  private readonly avatarUrls = inject(AvatarUrlService);
  private readonly devices = inject(MediaDevicesService);
  private readonly mediaPolicy = inject(MediaPolicyService);

  /** `<audio>` del par (cámara y pantalla): se enrutan al altavoz elegido en Devices. */
  private readonly audioElements = viewChildren<ElementRef<HTMLAudioElement>>('remoteAudio');

  readonly phase = this.call.phase;
  readonly kind = this.call.kind;
  readonly peerDisplayName = this.call.peerDisplayName;
  readonly peerUserId = this.call.peerUserId;
  /** Foto del par (con iniciales de respaldo en `app-avatar`). */
  readonly peerAvatarUrl = computed(() => this.avatarUrls.url(this.call.peerAvatarFileId()));
  readonly audioEnabled = this.call.audioEnabled;
  readonly videoEnabled = this.call.videoEnabled;
  readonly screenSharing = this.call.screenSharing;
  readonly muteReason = this.call.muteReason;
  readonly videoPausedByNetwork = this.call.videoPausedByNetwork;
  readonly peerCameraOn = this.call.peerCameraOn;
  readonly peerScreenSharing = this.call.peerScreenSharing;
  readonly localStream = this.call.localStream;
  readonly localScreenStream = this.call.localScreenStream;
  readonly remoteCameraStream = this.call.remoteCameraStream;
  readonly remoteScreenStream = this.call.remoteScreenStream;
  /** El par envía ALGÚN video (cámara o pantalla). */
  readonly peerVideoActive = computed(() => this.peerCameraOn() || this.peerScreenSharing());
  readonly recordingState = this.call.recordingState;
  readonly recordingElapsedLabel = this.call.recordingElapsedLabel;
  /** F7 — restante hasta el tope de la grabación; null sin tope. */
  readonly recordingRemainingLabel = this.call.recordingRemainingLabel;
  readonly recordingConsentFrom = this.call.recordingConsentFrom;
  readonly isRecordingRequester = this.call.isRecordingRequester;
  readonly connectionQuality = this.call.connectionQuality;
  readonly connectionMetrics = this.call.connectionMetrics;
  readonly peerQuality = this.call.peerQuality;
  readonly reconnecting = this.call.reconnecting;
  readonly waitingForPermission = this.devices.waitingForPermission;
  /** T-58: entrante mientras estoy en una reunión → modal "In a meeting". */
  readonly incomingBlockedByMeeting = this.call.incomingBlockedByMeeting;

  /** Cifras de calidad (RTT/pérdida/jitter) solo para staff (D-39). */
  readonly showMetrics = computed(() => this.perms.isActor(...STAFF_ACTORS));
  /** D-42: la opción "Share screen with audio" depende de la política de la oficina. */
  readonly screenAudioAllowed = computed(() => this.mediaPolicy.policy()?.screenShare.audioAllowed ?? false);
  /** F4: aviso de tope de minutos ("Call ends in 5 minutes"); persiste hasta el siguiente umbral. */
  readonly durationWarningText = computed(() => {
    const warning = this.call.durationWarning();
    return warning ? `Call ends in ${durationWarningLabel(warning.remainingSeconds)}` : null;
  });
  /** Nombre del que pidió grabar (el par, en una llamada 1:1). */
  readonly recordingRequesterName = computed(() => (this.recordingConsentFrom() ? this.peerDisplayName() || 'The other participant' : null));
  readonly showQuality = computed(() => this.isActive() && !this.reconnecting());
  readonly devicesOpen = signal(false);

  /** Grabar: requiere soporte de MediaRecorder + permiso communication.call.record. */
  readonly canRecord = computed(() => typeof MediaRecorder !== 'undefined' && this.perms.has('communication.call.record'));
  readonly isRecording = computed(() => this.recordingState() === 'Recording');
  readonly isRecordingBusy = computed(() => isRecordingBusy(this.recordingState()));
  readonly showRecordButton = computed(() => this.isActive() && this.canRecord() && this.recordingState() === 'Idle');

  readonly visible = computed(() => this.phase() !== 'idle');
  readonly isIncoming = computed(() => this.phase() === 'incoming');
  readonly isOutgoing = computed(() => this.phase() === 'outgoing');
  readonly isConnecting = computed(() => this.phase() === 'connecting');
  readonly isActive = computed(() => this.phase() === 'active');
  readonly isVideo = computed(() => this.kind() === 'Video');
  /** Stage de video: hay video de alguien (cámara propia/ajena o pantalla) en una llamada conectándose/activa. */
  readonly showVideoStage = computed(
    () => (this.isVideo() || this.screenSharing() || this.peerVideoActive()) && (this.isConnecting() || this.isActive()),
  );
  /** Pantalla activa en el escenario: la del par tiene prioridad; si no, la mía si comparto. null = nadie. */
  readonly activeScreenStream = computed(() =>
    this.peerScreenSharing() ? this.remoteScreenStream() : this.screenSharing() ? this.localScreenStream() : null,
  );
  readonly isScreenStage = computed(() => !!this.activeScreenStream());
  /** Stream del escenario principal: la PANTALLA si alguien comparte, si no la CÁMARA del par. */
  readonly stageStream = computed(() => (this.isScreenStage() ? this.activeScreenStream() : this.remoteCameraStream()));
  /** Mostrar la cámara del par como PiP secundario cuando en el escenario hay una pantalla. */
  readonly showPeerCameraPip = computed(() => this.isScreenStage() && this.peerCameraOn());
  /** Placeholder (avatar) en el stage cuando el par NO envía cámara NI pantalla. */
  readonly showRemotePlaceholder = computed(
    () => this.isConnecting() || (this.isActive() && !this.peerCameraOn() && !this.peerScreenSharing()),
  );
  /** "Turn on video" en una llamada de audio activa (upgrade), solo con permiso de videollamada. */
  readonly canUpgradeToVideo = computed(() => this.isActive() && !this.isVideo() && this.perms.has('communication.videocall.start'));

  /** Texto de estado accesible (no solo color). */
  readonly statusLabel = computed(() => {
    switch (this.phase()) {
      case 'incoming':
        return `Incoming ${this.isVideo() ? 'video' : 'audio'} call`;
      case 'outgoing':
        return 'Calling…';
      case 'connecting':
        return 'Connecting…';
      case 'active':
        return 'In call';
      default:
        return '';
    }
  });

  private audioCtx: AudioContext | null = null;
  private ringTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Ringtone mientras la llamada está entrante (sonido sintetizado, sin assets).
    effect(() => {
      if (this.isIncoming()) {
        this.startRingtone();
      } else {
        this.stopRingtone();
      }
    });
    // Altavoz elegido en Devices → `setSinkId` en cada <audio> del par (donde el navegador lo soporte).
    effect(() => {
      const sinkId = this.devices.preferred().audioOutputId;
      for (const el of this.audioElements()) {
        void this.devices.applySinkId(el.nativeElement, sinkId);
      }
    });
  }

  ngOnDestroy(): void {
    this.stopRingtone();
  }

  accept(): void {
    void this.call.acceptIncoming();
  }

  decline(): void {
    void this.call.rejectIncoming();
  }

  end(): void {
    void this.call.endCall();
  }

  toggleAudio(): void {
    void this.call.toggleAudio();
  }

  toggleVideo(): void {
    void this.call.toggleVideo();
  }

  upgrade(): void {
    void this.call.upgradeToVideo();
  }

  shareScreen(request: ScreenShareRequest): void {
    void this.call.startScreenShare(request.withAudio);
  }

  stopScreenShare(): void {
    void this.call.stopScreenShare();
  }

  swapMicrophone(deviceId: string): void {
    void this.call.swapMicrophone(deviceId);
  }

  swapCamera(deviceId: string): void {
    void this.call.swapCamera(deviceId);
  }

  toggleRecording(): void {
    if (this.isRecording() && this.isRecordingRequester()) {
      void this.call.stopRecording();
    } else if (this.recordingState() === 'Idle') {
      void this.call.requestRecording();
    }
  }

  acceptRecording(): void {
    void this.call.respondRecordingConsent(true);
  }

  declineRecording(): void {
    void this.call.respondRecordingConsent(false);
  }

  private startRingtone(): void {
    if (this.ringTimer) {
      return;
    }
    try {
      this.audioCtx ??= new AudioContext();
      void this.audioCtx.resume(); // el navegador puede exigir gesto previo; best-effort
    } catch {
      return; // sin WebAudio: la tarjeta visual sigue apareciendo igual
    }
    this.playRing();
    this.ringTimer = setInterval(() => this.playRing(), 2600);
  }

  private stopRingtone(): void {
    if (this.ringTimer) {
      clearInterval(this.ringTimer);
      this.ringTimer = null;
    }
  }

  /** Doble tono breve tipo timbre (dos beeps sinusoidales con envolvente suave). */
  private playRing(): void {
    const ctx = this.audioCtx;
    if (!ctx) {
      return;
    }
    [0, 0.4].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 480 : 440;
      const t0 = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.14, t0 + 0.05);
      gain.gain.linearRampToValueAtTime(0, t0 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    });
  }
}
