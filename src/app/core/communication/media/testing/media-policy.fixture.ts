import { signal } from '@angular/core';
import { MediaPolicyDto } from '../media-policy.model';

/**
 * Política de media COMPLETA para specs (mismos fallbacks que `technical-limits.ts` del backend).
 * Solo para tests: los servicios reales nunca usan estos números.
 */
export function mediaPolicyFixture(overrides: Partial<MediaPolicyDto> = {}): MediaPolicyDto {
  return {
    version: 1,
    quality: {
      sampleIntervalSeconds: 3,
      thresholds: {
        excellent: { rttMs: 150, lossPct: 2, jitterMs: 30 },
        good: { rttMs: 300, lossPct: 5, jitterMs: 50 },
        unstable: { rttMs: 500, lossPct: 10, jitterMs: 100 },
      },
      upgradeSamples: 2,
      poorSustainedSamples: 3,
      recoverySamples: 3,
    },
    video: {
      camera: { maxWidth: 1280, maxHeight: 720, maxFps: 30, maxBitrateKbps: 1250 },
      meshCamera: { maxWidth: 640, maxHeight: 360, maxFps: 24 },
      screen: { maxWidth: 1920, maxHeight: 1080, maxFps: 15, videoFps: 30, bitrateKbps: 1500, highBitrateKbps: 3000 },
    },
    audio: {
      opusFec: true,
      opusDtx: true,
      maxAverageBitrateKbps: 40,
      clientRecordingKbps: 56,
      processing: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      muteReleasesHardwareMinutes: 5,
    },
    screenShare: { clientsCanShare: true, audioAllowed: true },
    sounds: { policy: 'all', volumePct: 60, repeatGapMs: 400, muted: false },
    echo: { detectionEnabled: true, muteOnEcho: false },
    reactions: { enabled: true, catalog: ['👍', '👏', '❤️', '😂', '😮', '🎉', '🙏', '🤔', '✅', '🔥'], durationSeconds: 4, perUserPer10s: 5 },
    speaking: { maxPerSecond: 5 },
    preferences: {
      joinMuted: false,
      joinCameraOff: false,
      preferAudioOnly: false,
      audioProcessing: { echoCancellation: null, noiseSuppression: null, autoGainControl: null },
    },
    ...overrides,
  };
}

/** Doble de `MediaPolicyService` ya cargado. */
export function fakeMediaPolicyService(policy: MediaPolicyDto = mediaPolicyFixture()) {
  const current = signal<MediaPolicyDto | null>(policy);
  return {
    policy: current,
    ensureLoaded: () => Promise.resolve(current()!),
    refresh: () => Promise.resolve(current()!),
    updatePreferences: () => Promise.resolve(current()!),
  };
}
