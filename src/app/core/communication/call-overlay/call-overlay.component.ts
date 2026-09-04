import { Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '@core/auth/auth.service';
import { ActiveCallService } from '../active-call.service';
import { SrcObjectDirective } from '../src-object.directive';

/**
 * Overlay global de la llamada 1:1 activa. Montado una vez en el shell autenticado
 * para aparecer en cualquier página (entrante, saliente o en curso). Solo LEE los
 * signals de ActiveCallService.
 *  - Audio: tarjeta compacta; el `<audio>` reproduce al remoto.
 *  - Video: stage grande con video remoto + PiP local + controles (mute/cámara/colgar).
 */
@Component({
  selector: 'app-call-overlay',
  imports: [CommonModule, SrcObjectDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './call-overlay.component.html',
})
export class CallOverlayComponent implements OnDestroy {
  private readonly call = inject(ActiveCallService);
  private readonly auth = inject(AuthService);

  readonly phase = this.call.phase;
  readonly kind = this.call.kind;
  readonly peerDisplayName = this.call.peerDisplayName;
  readonly audioEnabled = this.call.audioEnabled;
  readonly videoEnabled = this.call.videoEnabled;
  readonly screenSharing = this.call.screenSharing;
  readonly peerVideoActive = this.call.peerVideoActive;
  readonly localStream = this.call.localStream;
  readonly remoteStream = this.call.remoteStream;
  readonly recordingState = this.call.recordingState;
  readonly recordingElapsedLabel = this.call.recordingElapsedLabel;
  readonly recordingConsentFrom = this.call.recordingConsentFrom;
  readonly isRecordingRequester = this.call.isRecordingRequester;
  readonly connectionQuality = this.call.connectionQuality;
  readonly reconnecting = this.call.reconnecting;

  /** Nº de barras activas del indicador de señal (0–3) según la calidad local. */
  readonly qualityBars = computed(() => {
    switch (this.connectionQuality()) {
      case 'Excellent':
      case 'Good':
        return 3;
      case 'Fair':
        return 2;
      case 'Poor':
        return 1;
      default:
        return 0;
    }
  });
  readonly qualityColor = computed(() => {
    switch (this.connectionQuality()) {
      case 'Excellent':
      case 'Good':
        return 'bg-emerald-400';
      case 'Fair':
        return 'bg-amber-400';
      default:
        return 'bg-red-400';
    }
  });
  readonly showQuality = computed(() => this.isActive() && !this.reconnecting());

  /** getDisplayMedia solo existe en escritorio — el botón de compartir se oculta donde no aplica. */
  readonly canScreenShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  /** Grabar: requiere soporte de MediaRecorder + permiso communication.call.record. */
  readonly canRecord = computed(
    () =>
      typeof MediaRecorder !== 'undefined' &&
      (this.auth.currentUser()?.permissions.includes('communication.call.record') ?? false),
  );
  readonly isRecording = computed(() => this.recordingState() === 'Recording');
  readonly isRecordingBusy = computed(() => ['Requesting', 'Stopping', 'Processing'].includes(this.recordingState()));
  readonly showRecordButton = computed(() => this.isActive() && this.canRecord() && this.recordingState() === 'Idle');

  readonly visible = computed(() => this.phase() !== 'idle');
  readonly isIncoming = computed(() => this.phase() === 'incoming');
  readonly isOutgoing = computed(() => this.phase() === 'outgoing');
  readonly isConnecting = computed(() => this.phase() === 'connecting');
  readonly isActive = computed(() => this.phase() === 'active');
  readonly isVideo = computed(() => this.kind() === 'Video');
  /** Stage de video: hay video de alguien (cámara propia/ajena o pantalla) en una llamada conectándose/activa. */
  readonly showVideoStage = computed(
    () =>
      (this.isVideo() || this.screenSharing() || this.peerVideoActive()) &&
      (this.isConnecting() || this.isActive()),
  );
  /** Placeholder (avatar) en el stage remoto cuando el par NO envía video. */
  readonly showRemotePlaceholder = computed(() => this.isConnecting() || (this.isActive() && !this.peerVideoActive()));
  /** "Turn on video" en una llamada de audio activa (upgrade), solo con permiso de videollamada. */
  readonly canUpgradeToVideo = computed(
    () =>
      this.isActive() &&
      !this.isVideo() &&
      (this.auth.currentUser()?.permissions.includes('communication.videocall.start') ?? false),
  );

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
  }

  ngOnDestroy(): void {
    this.stopRingtone();
  }

  initials(name: string | null): string {
    return (name ?? '?')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
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
    this.call.toggleAudio();
  }

  toggleVideo(): void {
    this.call.toggleVideo();
  }

  upgrade(): void {
    void this.call.upgradeToVideo();
  }

  toggleScreenShare(): void {
    if (this.screenSharing()) {
      void this.call.stopScreenShare();
    } else {
      void this.call.startScreenShare();
    }
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
