import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { ToastService } from '@shared/ui/toast/toast.service';
import { MediaAccessError, MediaDeviceKind, toMediaAccessError } from './media-errors';

export type MediaPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

/** Ids preferidos por navegador (NO van al servidor): `localStorage` `tvf.media.devices`. */
export interface PreferredDevices {
  audioInputId: string | null;
  videoInputId: string | null;
  audioOutputId: string | null;
}

export interface NewDeviceNotice {
  kind: 'microphone' | 'camera' | 'speaker';
  device: MediaDeviceInfo;
}

export const PREFERRED_DEVICES_KEY = 'tvf.media.devices';
/** Si el navegador tarda más que esto en responder a getUserMedia, está mostrando el prompt de permiso. */
const PROMPT_WAIT_MS = 1500;
/** Duración y volumen del tono de "Test speaker" (defaults técnicos del cliente, no reglas de negocio). */
const TEST_TONE_MS = 350;
const TEST_TONE_HZ = 660;
const TEST_TONE_GAIN = 0.2;

const NO_PREFERENCE: PreferredDevices = { audioInputId: null, videoInputId: null, audioOutputId: null };

/**
 * F4 (T-59) — Dispositivos de media: inventario (`enumerateDevices` + `devicechange`), permisos
 * tipados, captura con errores tipados (`MediaAccessError`), preferencias de deviceId por navegador,
 * `setSinkId`, "Test speaker" y avisos de dispositivo nuevo / desconectado.
 *
 * No captura por su cuenta: `LocalMediaSession` le pide la captura y le informa qué dispositivo está
 * usando (`setActive`). Uso típico desde la UI (panel Devices, lobby):
 *   devices.refreshInventory(); devices.microphones(); devices.setPreferred('audioInputId', id);
 */
@Injectable({ providedIn: 'root' })
export class MediaDevicesService {
  private readonly toast = inject(ToastService);

  readonly microphones = signal<MediaDeviceInfo[]>([]);
  readonly cameras = signal<MediaDeviceInfo[]>([]);
  readonly speakers = signal<MediaDeviceInfo[]>([]);
  readonly microphonePermission = signal<MediaPermissionState>('prompt');
  readonly cameraPermission = signal<MediaPermissionState>('prompt');
  readonly preferred = signal<PreferredDevices>(readPreferred());
  /** Ids en uso ahora mismo (los fija la sesión); null = default del sistema. */
  readonly activeMicrophoneId = signal<string | null>(null);
  readonly activeCameraId = signal<string | null>(null);
  /** true mientras el navegador está mostrando el prompt de permiso ("Waiting for permission…"). */
  readonly waitingForPermission = signal(false);
  /** Último dispositivo nuevo detectado (la UI ofrece "Switch?"); null = nada pendiente. */
  readonly newDevice = signal<NewDeviceNotice | null>(null);
  private readonly _newDevice$ = new Subject<NewDeviceNotice>();
  readonly newDevice$: Observable<NewDeviceNotice> = this._newDevice$.asObservable();

  /** `setSinkId` existe en Chromium/Firefox de escritorio; en Safari no. */
  readonly supportsSinkId =
    typeof HTMLMediaElement !== 'undefined' && typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === 'function';

  private listening = false;
  private knownIds = new Set<string>();

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /** Lista dispositivos (los labels solo vienen tras el primer permiso) y se suscribe a `devicechange`. */
  async refreshInventory(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    let list: MediaDeviceInfo[];
    try {
      list = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return;
    }
    this.microphones.set(list.filter(d => d.kind === 'audioinput'));
    this.cameras.set(list.filter(d => d.kind === 'videoinput'));
    this.speakers.set(list.filter(d => d.kind === 'audiooutput'));
    this.watchDeviceChanges();
    this.knownIds = new Set(list.map(d => `${d.kind}:${d.deviceId}`));
  }

  /** Permisos vía Permissions API (si el navegador la soporta para cámara/micro). */
  async queryPermissions(): Promise<void> {
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!perms?.query) {
      return;
    }
    for (const [name, target] of [
      ['microphone', this.microphonePermission],
      ['camera', this.cameraPermission],
    ] as const) {
      try {
        const status = await perms.query({ name: name as PermissionName });
        target.set(status.state as MediaPermissionState);
        status.onchange = () => target.set(status.state as MediaPermissionState);
      } catch {
        /* Firefox no expone camera/microphone en Permissions: se deja 'prompt' hasta capturar */
      }
    }
  }

  setPreferred(key: keyof PreferredDevices, deviceId: string | null): void {
    const next = { ...this.preferred(), [key]: deviceId };
    this.preferred.set(next);
    try {
      localStorage.setItem(PREFERRED_DEVICES_KEY, JSON.stringify(next));
    } catch {
      /* sin storage (privado/tests) */
    }
  }

  /** La sesión informa qué dispositivo quedó en uso (para detectar su desconexión). */
  setActive(kind: 'microphone' | 'camera', deviceId: string | null): void {
    (kind === 'microphone' ? this.activeMicrophoneId : this.activeCameraId).set(deviceId);
  }

  /**
   * `getUserMedia` con errores tipados. Si el deviceId preferido ya no existe (`Overconstrained`) se
   * reintenta SIN deviceId y se olvida la preferencia. Marca `waitingForPermission` mientras el
   * navegador pregunta. Actualiza permisos e inventario al conceder.
   */
  async getUserMedia(
    constraints: MediaStreamConstraints,
    device: Exclude<MediaDeviceKind, 'screen'>,
    options: UserMediaOptions = {},
  ): Promise<MediaStream> {
    if (!this.isSupported()) {
      throw new MediaAccessError('Unsupported', device, `This browser cannot access the ${device}.`);
    }
    try {
      const stream = await this.withPromptFlag(navigator.mediaDevices.getUserMedia(constraints));
      this.markGranted(constraints);
      void this.refreshInventory();
      return stream;
    } catch (err) {
      const typed = toMediaAccessError(err, device);
      if (typed.kind === 'Overconstrained' && hasDeviceId(constraints)) {
        this.forgetDevicePreference(constraints);
        return this.getUserMedia(stripDeviceIds(constraints), device, options);
      }
      if (typed.kind === 'NotReadable' && options.fallbackWhenUnreadable) {
        const recovered = await this.openAnotherDevice(constraints, device);
        if (recovered) {
          return recovered;
        }
      }
      if (typed.kind === 'NotAllowed') {
        if (constraints.audio) {
          this.microphonePermission.set('denied');
        }
        if (constraints.video) {
          this.cameraPermission.set('denied');
        }
      }
      throw typed;
    }
  }

  async getDisplayMedia(constraints: DisplayMediaStreamOptions): Promise<MediaStream> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      throw new MediaAccessError('Unsupported', 'screen', 'Screen sharing is not available in this browser.');
    }
    try {
      return await navigator.mediaDevices.getDisplayMedia(constraints);
    } catch (err) {
      throw toMediaAccessError(err, 'screen');
    }
  }

  /** Enruta un `<audio>/<video>` al altavoz elegido (o al preferido). Devuelve false si no se pudo. */
  async applySinkId(element: HTMLMediaElement, deviceId: string | null = this.preferred().audioOutputId): Promise<boolean> {
    const sink = element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
    if (!deviceId || typeof sink.setSinkId !== 'function') {
      return false;
    }
    try {
      await sink.setSinkId(deviceId);
      return true;
    } catch {
      return false;
    }
  }

  /** "Test speaker": tono corto por el altavoz elegido (AudioContext; `setSinkId` donde exista). */
  async testSpeaker(deviceId: string | null = this.preferred().audioOutputId): Promise<boolean> {
    if (typeof AudioContext === 'undefined') {
      return false;
    }
    const ctx = new AudioContext() as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    try {
      if (deviceId && typeof ctx.setSinkId === 'function') {
        await ctx.setSinkId(deviceId).catch(() => undefined);
      }
      await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = TEST_TONE_HZ;
      gain.gain.value = TEST_TONE_GAIN;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      await new Promise(resolve => setTimeout(resolve, TEST_TONE_MS));
      osc.stop();
      return true;
    } catch {
      return false;
    } finally {
      void ctx.close().catch(() => undefined);
    }
  }

  /** Siguiente dispositivo del mismo tipo distinto al que se perdió (preferido primero). */
  pickFallback(kind: 'microphone' | 'camera', excludeId: string | null): MediaDeviceInfo | null {
    const list = kind === 'microphone' ? this.microphones() : this.cameras();
    const preferredId = kind === 'microphone' ? this.preferred().audioInputId : this.preferred().videoInputId;
    const candidates = list.filter(d => d.deviceId && d.deviceId !== excludeId && d.deviceId !== 'default');
    return candidates.find(d => d.deviceId === preferredId) ?? candidates[0] ?? null;
  }

  /** Aviso de hardware perdido en caliente (la sesión ya intentó el fallback). */
  notifyDeviceLost(kind: 'microphone' | 'camera', replaced: boolean): void {
    const name = kind === 'microphone' ? 'microphone' : 'camera';
    this.toast.info(replaced ? `Your ${name} was disconnected. Switched to another ${name}.` : `Your ${name} was disconnected.`);
  }

  dismissNewDevice(): void {
    this.newDevice.set(null);
  }

  // ---------- internos ----------

  private watchDeviceChanges(): void {
    if (this.listening || !navigator.mediaDevices?.addEventListener) {
      return;
    }
    this.listening = true;
    navigator.mediaDevices.addEventListener('devicechange', () => void this.onDeviceChange());
  }

  private async onDeviceChange(): Promise<void> {
    const before = this.knownIds;
    await this.refreshInventory();
    const after = this.knownIds;
    for (const key of after) {
      if (before.has(key)) {
        continue;
      }
      const [kind, deviceId] = key.split(':');
      if (deviceId === 'default' || deviceId === 'communications') {
        continue; // alias de Windows, no es un dispositivo nuevo
      }
      const device = [...this.microphones(), ...this.cameras(), ...this.speakers()].find(d => d.kind === kind && d.deviceId === deviceId);
      if (!device) {
        continue;
      }
      const notice: NewDeviceNotice = {
        kind: kind === 'audioinput' ? 'microphone' : kind === 'videoinput' ? 'camera' : 'speaker',
        device,
      };
      this.newDevice.set(notice);
      this._newDevice$.next(notice);
      if (notice.kind === 'microphone') {
        this.toast.info('New microphone detected.');
      }
    }
  }

  private async withPromptFlag<T>(promise: Promise<T>): Promise<T> {
    const timer = setTimeout(() => this.waitingForPermission.set(true), PROMPT_WAIT_MS);
    try {
      return await promise;
    } finally {
      clearTimeout(timer);
      this.waitingForPermission.set(false);
    }
  }

  private markGranted(constraints: MediaStreamConstraints): void {
    if (constraints.audio) {
      this.microphonePermission.set('granted');
    }
    if (constraints.video) {
      this.cameraPermission.set('granted');
    }
  }

  /**
   * El dispositivo preferido existe pero no arranca (ocupado por otra app o una cámara virtual sin
   * fuente): se usa el primero de los demás que sí abra, queda como preferido y se avisa.
   */
  private async openAnotherDevice(
    constraints: MediaStreamConstraints,
    device: Exclude<MediaDeviceKind, 'screen'>,
  ): Promise<MediaStream | null> {
    const key = device === 'camera' ? 'video' : 'audio';
    const current = constraints[key];
    if (!current) {
      return null;
    }
    await this.refreshInventory();
    const list = device === 'camera' ? this.cameras() : this.microphones();
    const failedId = exactDeviceId(current) ?? (device === 'camera' ? this.preferred().videoInputId : this.preferred().audioInputId);
    const failed = list.find(d => d.deviceId === failedId) ?? null;
    // "default"/"communications" son alias del mismo hardware (mismo groupId): no son otra opción.
    const candidates = list.filter(
      d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== failedId && !(failed?.groupId && d.groupId === failed.groupId),
    );
    const base = typeof current === 'object' ? current : {};
    for (const candidate of candidates) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ ...constraints, [key]: { ...base, deviceId: { exact: candidate.deviceId } } });
        this.setPreferred(device === 'camera' ? 'videoInputId' : 'audioInputId', candidate.deviceId);
        this.markGranted(constraints);
        void this.refreshInventory();
        this.toast.info(`${failed?.label || `Your ${device}`} isn't available. Using ${candidate.label || `another ${device}`}.`);
        return stream;
      } catch {
        /* este tampoco abre: se prueba el siguiente */
      }
    }
    return null;
  }

  private forgetDevicePreference(constraints: MediaStreamConstraints): void {
    if (hasDeviceId(constraints.audio)) {
      this.setPreferred('audioInputId', null);
    }
    if (hasDeviceId(constraints.video)) {
      this.setPreferred('videoInputId', null);
    }
  }
}

/** Opciones de `getUserMedia`. */
export interface UserMediaOptions {
  /** Se está abriendo el dispositivo PREFERIDO (no una elección explícita): si no arranca, probar los demás. */
  readonly fallbackWhenUnreadable?: boolean;
}

function exactDeviceId(value: boolean | MediaTrackConstraints): string | null {
  if (typeof value !== 'object') {
    return null;
  }
  const id = value.deviceId;
  if (typeof id === 'string') {
    return id;
  }
  if (id && typeof id === 'object' && !Array.isArray(id)) {
    const exact = (id as ConstrainDOMStringParameters).exact;
    return typeof exact === 'string' ? exact : Array.isArray(exact) ? (exact[0] ?? null) : null;
  }
  return null;
}

function hasDeviceId(value: MediaStreamConstraints | boolean | MediaTrackConstraints | undefined): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if ('audio' in value || 'video' in value) {
    const c = value as MediaStreamConstraints;
    return hasDeviceId(c.audio) || hasDeviceId(c.video);
  }
  return (value as MediaTrackConstraints).deviceId !== undefined;
}

function stripDeviceIds(constraints: MediaStreamConstraints): MediaStreamConstraints {
  const strip = (c: boolean | MediaTrackConstraints | undefined) => {
    if (!c || typeof c !== 'object') {
      return c;
    }
    const { deviceId: _omit, ...rest } = c;
    return Object.keys(rest).length ? rest : true;
  };
  return { audio: strip(constraints.audio), video: strip(constraints.video) };
}

function readPreferred(): PreferredDevices {
  try {
    const raw = localStorage.getItem(PREFERRED_DEVICES_KEY);
    if (!raw) {
      return NO_PREFERENCE;
    }
    const parsed = JSON.parse(raw) as Partial<PreferredDevices>;
    return {
      audioInputId: parsed.audioInputId ?? null,
      videoInputId: parsed.videoInputId ?? null,
      audioOutputId: parsed.audioOutputId ?? null,
    };
  } catch {
    return NO_PREFERENCE;
  }
}
