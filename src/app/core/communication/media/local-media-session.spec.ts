import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMediaSession } from './local-media-session';
import type { MediaDevicesService } from './media-devices.service';
import { MediaAccessError } from './media-errors';
import { mediaPolicyFixture } from './testing/media-policy.fixture';

/** Pista de mentira: lo justo que toca la sesión. */
class FakeTrack {
  enabled = true;
  readyState: 'live' | 'ended' = 'live';
  onended: (() => void) | null = null;
  contentHint = '';
  readonly stop = vi.fn(() => (this.readyState = 'ended'));
  readonly applyConstraints = vi.fn().mockResolvedValue(undefined);
  constructor(
    readonly kind: 'audio' | 'video',
    readonly id = `${kind}-${Math.random().toString(36).slice(2, 6)}`,
    private readonly deviceId = 'dev-1',
  ) {}
  getSettings() {
    return { deviceId: this.deviceId, width: 1280 };
  }
}

class FakeStream {
  constructor(private tracks: FakeTrack[] = []) {}
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter(t => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter(t => t.kind === 'video');
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack) {
    this.tracks = this.tracks.filter(x => x !== t);
  }
}

function fakeDevices() {
  return {
    preferred: signal({ audioInputId: 'mic-pref', videoInputId: null, audioOutputId: null }),
    activeMicrophoneId: signal<string | null>(null),
    activeCameraId: signal<string | null>(null),
    getUserMedia: vi.fn(),
    getDisplayMedia: vi.fn(),
    setPreferred: vi.fn(),
    setActive: vi.fn(),
    refreshInventory: vi.fn().mockResolvedValue(undefined),
    pickFallback: vi.fn().mockReturnValue(null),
    notifyDeviceLost: vi.fn(),
  };
}

describe('LocalMediaSession', () => {
  const originalMediaStream = globalThis.MediaStream;
  let devices: ReturnType<typeof fakeDevices>;
  let replaced: ReturnType<typeof vi.fn<(source: string, track: unknown) => Promise<void>>>;
  let stopped: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    globalThis.MediaStream = FakeStream as unknown as typeof MediaStream;
    devices = fakeDevices();
    replaced = vi.fn<(source: string, track: unknown) => Promise<void>>().mockResolvedValue(undefined);
    stopped = vi.fn<() => void>();
  });

  afterEach(() => {
    globalThis.MediaStream = originalMediaStream;
    vi.useRealTimers();
  });

  function build(policyOverrides: Parameters<typeof mediaPolicyFixture>[0] = {}) {
    return new LocalMediaSession(mediaPolicyFixture(policyOverrides), devices as unknown as MediaDevicesService, {
      onLocalTrackReplaced: replaced as (source: string, track: MediaStreamTrack | null) => Promise<void>,
      onScreenShareStopped: stopped,
    });
  }

  it('acquire pide el deviceId preferido y las constraints de la política (AEC/NS/AGC, resolución, fps)', async () => {
    const mic = new FakeTrack('audio');
    const cam = new FakeTrack('video');
    devices.getUserMedia.mockResolvedValue(new FakeStream([mic, cam]));
    const session = build({ audio: { ...mediaPolicyFixture().audio, processing: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } } });

    const result = await session.acquire({ audio: true, video: true, profile: 'meshCamera' });

    expect(result).toEqual({ audio: true, video: true, audioError: null, videoError: null });
    expect(devices.getUserMedia).toHaveBeenCalledWith(
      {
        audio: { deviceId: { exact: 'mic-pref' }, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
        video: { width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 }, frameRate: { ideal: 24, max: 24 } },
      },
      'camera',
    );
    expect(session.audioEnabled()).toBe(true);
    expect(session.videoEnabled()).toBe(true);
    expect(session.stream()?.getTracks()).toHaveLength(2);
    expect(devices.setActive).toHaveBeenCalledWith('microphone', 'dev-1');
  });

  it('si cámara+micro falla cae a solo audio y reporta el error de la cámara', async () => {
    const mic = new FakeTrack('audio');
    devices.getUserMedia
      .mockRejectedValueOnce(new MediaAccessError('NotReadable', 'camera', 'The camera is in use by another app.'))
      .mockResolvedValueOnce(new FakeStream([mic]));
    const session = build();

    const result = await session.acquire({ audio: true, video: true });

    expect(result.audio).toBe(true);
    expect(result.video).toBe(false);
    expect(result.videoError?.kind).toBe('NotReadable');
    expect(session.videoEnabled()).toBe(false);
    expect(devices.getUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({ video: false }), 'microphone');
  });

  it('mute libera el micrófono tras N minutos y lo re-adquiere al desmutear', async () => {
    vi.useFakeTimers();
    const mic = new FakeTrack('audio');
    devices.getUserMedia.mockResolvedValueOnce(new FakeStream([mic]));
    const session = build({ audio: { ...mediaPolicyFixture().audio, muteReleasesHardwareMinutes: 5 } });
    await session.acquire({ audio: true, video: false });

    await session.setAudioEnabled(false, 'user');
    expect(mic.enabled).toBe(false);
    expect(session.muteReason()).toBe('user');
    expect(mic.stop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(mic.stop).toHaveBeenCalled();
    expect(session.microphoneReleased()).toBe(true);
    expect(replaced).toHaveBeenCalledWith('microphone', null);
    expect(session.stream()?.getAudioTracks()).toHaveLength(0);

    const mic2 = new FakeTrack('audio');
    devices.getUserMedia.mockResolvedValueOnce(new FakeStream([mic2]));
    await session.setAudioEnabled(true);
    expect(session.audioEnabled()).toBe(true);
    expect(session.microphoneReleased()).toBe(false);
    expect(session.muteReason()).toBeNull();
    expect(replaced).toHaveBeenLastCalledWith('microphone', mic2);
    expect(session.stream()?.getAudioTracks()).toEqual([mic2]);
  });

  it('con muteReleasesHardwareMinutes = 0 el mute nunca suelta el micrófono', async () => {
    vi.useFakeTimers();
    const mic = new FakeTrack('audio');
    devices.getUserMedia.mockResolvedValueOnce(new FakeStream([mic]));
    const session = build({ audio: { ...mediaPolicyFixture().audio, muteReleasesHardwareMinutes: 0 } });
    await session.acquire({ audio: true, video: false });
    await session.setAudioEnabled(false);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(mic.stop).not.toHaveBeenCalled();
    expect(session.microphoneReleased()).toBe(false);
  });

  it('apagar la cámara la DETIENE (LED off) y avisa el reemplazo; encenderla la re-adquiere', async () => {
    const mic = new FakeTrack('audio');
    const cam = new FakeTrack('video');
    devices.getUserMedia.mockResolvedValueOnce(new FakeStream([mic, cam]));
    const session = build();
    await session.acquire({ audio: true, video: true });

    await session.setVideoEnabled(false);
    expect(cam.stop).toHaveBeenCalled();
    expect(session.videoEnabled()).toBe(false);
    expect(replaced).toHaveBeenCalledWith('camera', null); // sin canvas en jsdom: sin placeholder

    const cam2 = new FakeTrack('video');
    devices.getUserMedia.mockResolvedValueOnce(new FakeStream([cam2]));
    await session.setVideoEnabled(true);
    expect(session.videoEnabled()).toBe(true);
    expect(replaced).toHaveBeenLastCalledWith('camera', cam2);
    expect(session.stream()?.getVideoTracks()).toEqual([cam2]);
  });

  it('pantalla con audio (T-52/D-41): perfil de la política, contentHint detail, onended → stop y aviso', async () => {
    devices.getUserMedia.mockResolvedValueOnce(new FakeStream([new FakeTrack('audio')]));
    const screen = new FakeTrack('video');
    const screenAudio = new FakeTrack('audio');
    devices.getDisplayMedia.mockResolvedValueOnce(new FakeStream([screen, screenAudio]));
    const session = build();
    await session.acquire({ audio: true, video: false });

    expect(await session.startScreenShare({ withAudio: true })).toBe(true);
    expect(devices.getDisplayMedia).toHaveBeenCalledWith({
      video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 15 } },
      audio: true,
    });
    expect(screen.contentHint).toBe('detail');
    expect(session.screenSharing()).toBe(true);
    expect(session.screenAudioTrack()).toBe(screenAudio);
    expect(replaced).toHaveBeenCalledWith('screen', screen);
    expect(replaced).toHaveBeenCalledWith('screen-audio', screenAudio);

    // Botón nativo "Stop sharing" del navegador.
    screen.onended?.();
    await vi.waitFor(() => expect(session.screenSharing()).toBe(false));
    expect(screen.stop).toHaveBeenCalled();
    expect(screenAudio.stop).toHaveBeenCalled();
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledTimes(1));
  });

  it('sin screenAudioAllowed no pide audio de pantalla aunque el llamador lo quiera', async () => {
    devices.getUserMedia.mockResolvedValueOnce(new FakeStream([new FakeTrack('audio')]));
    devices.getDisplayMedia.mockResolvedValueOnce(new FakeStream([new FakeTrack('video')]));
    const session = build({ screenShare: { clientsCanShare: true, audioAllowed: false } });
    await session.acquire({ audio: true, video: false });

    await session.startScreenShare({ withAudio: true, optimizeForVideo: true });

    expect(devices.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false, video: expect.objectContaining({ frameRate: { max: 30 } }) }));
    expect(session.screenAudioTrack()).toBeNull();
  });

  it('pausa por red no toca videoEnabled y muteReason dice network', async () => {
    const cam = new FakeTrack('video');
    devices.getUserMedia.mockResolvedValueOnce(new FakeStream([new FakeTrack('audio'), cam]));
    const session = build();
    await session.acquire({ audio: true, video: true });

    session.pauseVideoForNetwork();
    expect(cam.enabled).toBe(false);
    expect(session.videoEnabled()).toBe(true);
    expect(session.muteReason()).toBe('network');
    session.resumeVideoAfterNetwork();
    expect(cam.enabled).toBe(true);
    expect(session.muteReason()).toBeNull();
  });

  it('release detiene todo el hardware', async () => {
    const mic = new FakeTrack('audio');
    const cam = new FakeTrack('video');
    devices.getUserMedia.mockResolvedValueOnce(new FakeStream([mic, cam]));
    const session = build();
    await session.acquire({ audio: true, video: true });
    session.release();
    expect(mic.stop).toHaveBeenCalled();
    expect(cam.stop).toHaveBeenCalled();
    expect(session.stream()).toBeNull();
    expect(session.trackSettingsSnapshot()).toEqual({ microphone: null, camera: null, screen: null });
  });
});
