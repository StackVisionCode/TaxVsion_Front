/**
 * F4 — Política de media (`GET /communication/media-policy`), espejo EXACTO del `MediaPolicyDto` del
 * backend Communication. Todo lo que antes eran constantes del cliente (umbrales de calidad,
 * resoluciones, bitrates, Opus, sonidos…) viene de acá; la capa de media NUNCA inventa números.
 */

/** Calidad de conexión (nombres del dominio). `Fair` se muestra como "Unstable" en la UI. */
export type ConnectionQuality = 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Disconnected';

export interface QualityThreshold {
  rttMs: number;
  lossPct: number;
  jitterMs: number;
}

export interface VideoProfile {
  maxWidth: number;
  maxHeight: number;
  maxFps: number;
}

/** Cámara: resolución/fps + capa alta de simulcast (`maxBitrateKbps`; las capas ½ y ¼ se derivan). */
export interface CameraVideoProfile extends VideoProfile {
  maxBitrateKbps: number;
}

export interface ScreenProfile extends VideoProfile {
  /** fps al compartir contenido en movimiento (video); `maxFps` es para documentos/pantalla estática. */
  videoFps: number;
  bitrateKbps: number;
  highBitrateKbps: number;
}

export interface AudioProcessing {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export type SoundsPolicy = 'all' | 'hostOnly' | 'off';

export interface ReactionsPolicy {
  enabled: boolean;
  catalog: string[];
  durationSeconds: number;
  perUserPer10s: number;
}

export interface MediaPolicyDto {
  /** platformVersion: el front refresca si cambia (socket `settings.changed`). */
  version: number;
  quality: {
    sampleIntervalSeconds: number;
    thresholds: { excellent: QualityThreshold; good: QualityThreshold; unstable: QualityThreshold };
    upgradeSamples: number;
    poorSustainedSamples: number;
    recoverySamples: number;
  };
  video: {
    camera: CameraVideoProfile;
    meshCamera: VideoProfile;
    screen: ScreenProfile;
  };
  audio: {
    opusFec: boolean;
    opusDtx: boolean;
    maxAverageBitrateKbps: number;
    /** Bitrate de audio de la grabación local (C-03), en kbps. */
    clientRecordingKbps: number;
    /** Efectivo para el usuario (plataforma > oficina > preferencia). */
    processing: AudioProcessing;
    /** 0 = nunca liberar el micrófono al mutear. */
    muteReleasesHardwareMinutes: number;
  };
  screenShare: { clientsCanShare: boolean; audioAllowed: boolean };
  sounds: { policy: SoundsPolicy; volumePct: number; repeatGapMs: number; muted: boolean };
  echo: { detectionEnabled: boolean; muteOnEcho: boolean };
  /** F5 (D-50) — reacciones efímeras: catálogo curado y límites (la oficina puede apagarlas o recortar el catálogo). */
  reactions: ReactionsPolicy;
  /** F5 (T-69) — tope de emisiones `meeting.speaking` por segundo. */
  speaking: { maxPerSecond: number };
  preferences: {
    joinMuted: boolean;
    joinCameraOff: boolean;
    preferAudioOnly: boolean;
    /** F9: ventana flotante al ocultar la pestaña (opcional hasta que el backend la mande). */
    autoPictureInPicture?: boolean;
    audioProcessing: { echoCancellation: boolean | null; noiseSuppression: boolean | null; autoGainControl: boolean | null };
  };
}

/** Patch parcial de `PUT /communication/preferences`. */
export interface MediaPreferencesPatch {
  joinMuted?: boolean;
  joinCameraOff?: boolean;
  preferAudioOnly?: boolean;
  meetingSoundsMuted?: boolean;
  echoCancellation?: boolean | null;
  noiseSuppression?: boolean | null;
  autoGainControl?: boolean | null;
  autoPictureInPicture?: boolean;
  /** null = el idioma de la oficina. */
  transcriptLanguage?: string | null;
}

/** Etiqueta de UI: el dominio dice `Fair`, el usuario ve "Unstable". */
export function qualityLabel(quality: ConnectionQuality): string {
  return quality === 'Fair' ? 'Unstable' : quality;
}

/** Comprobación mínima de forma: un GET que devuelva otra cosa (SPA, error envuelto) no se cachea. */
export function isMediaPolicyDto(value: unknown): value is MediaPolicyDto {
  const dto = value as Partial<MediaPolicyDto> | null;
  return (
    !!dto &&
    typeof dto.version === 'number' &&
    !!dto.quality?.thresholds &&
    !!dto.video?.camera &&
    !!dto.audio?.processing &&
    !!dto.sounds &&
    !!dto.screenShare &&
    !!dto.echo &&
    !!dto.preferences
  );
}
