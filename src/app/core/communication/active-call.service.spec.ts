import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveCallService } from './active-call.service';
import { CallsService } from './calls.service';
import { IncomingCallDto } from './call.model';
import { MeetingSessionState } from './meeting-session-state';
import { SoundsService } from './media/sounds.service';
import { MediaPolicyService } from './media/media-policy.service';
import { ClientRecordingSession, RecordingUploadService } from './media/client-recording-session';
import { fakeMediaPolicyService, mediaPolicyFixture } from './media/testing/media-policy.fixture';
import { SFU_CAPTURE_PUBLISHER_FACTORY } from './media/sfu-capture-publisher.factory';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@shared/ui/toast/toast.service';

/** F7 — doble del publicador SFU (lo crea el token de fábrica): registra arranque, pistas y cierre. */
interface FakePublisher {
  options: { iceServers?: unknown };
  start: ReturnType<typeof vi.fn>;
  setTrack: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}
const capture = { instances: [] as FakePublisher[] };
async function fakePublisherFactory(options: { iceServers?: unknown }): Promise<FakePublisher> {
  const publisher: FakePublisher = {
    options,
    start: vi.fn().mockResolvedValue(true),
    setTrack: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };
  capture.instances.push(publisher);
  return publisher;
}

/** Doble del CallsService: cada `on*` es un Subject (los tests emiten a mano); acciones espiadas. */
function fakeCalls() {
  const incoming = new Subject<IncomingCallDto>();
  const consentRequested = new Subject<unknown>();
  const recordingState = new Subject<unknown>();
  const limitWarning = new Subject<unknown>();
  const captureRequested = new Subject<unknown>();
  const captureStopped = new Subject<unknown>();
  const noop = () => new Subject();
  return {
    incoming,
    consentRequested,
    recordingState,
    limitWarning,
    captureRequested,
    captureStopped,
    serverOffsetMs: signal(0),
    requestRecording: vi.fn().mockResolvedValue({}),
    respondRecordingConsent: vi.fn().mockResolvedValue({ response: 'Accepted' }),
    stopRecording: vi.fn().mockResolvedValue({}),
    sfuCreateTransport: vi.fn(),
    sfuConnectTransport: vi.fn(),
    sfuProduce: vi.fn(),
    getIceServers: () => of({ iceServers: [] }),
    initiate: vi.fn().mockResolvedValue({ callId: 'c1', ringingAtUtc: '' }),
    accept: vi.fn().mockResolvedValue({}),
    reject: vi.fn().mockResolvedValue({}),
    cancel: vi.fn().mockResolvedValue({}),
    end: vi.fn().mockResolvedValue({}),
    mediaStatus: vi.fn(),
    onIncoming: () => incoming,
    onStateChanged: noop,
    onPeerJoined: noop,
    onUserProfileChanged: noop,
    onSignalFrom: noop,
    onMediaStatusChanged: noop,
    onUpgradedToVideo: noop,
    onPeerQualityChanged: noop,
    onDurationWarning: noop,
    onRecordingConsentRequested: () => consentRequested,
    onRecordingConsentRecorded: noop,
    onRecordingStateChanged: () => recordingState,
    onRecordingLimitWarning: () => limitWarning,
    onCaptureRequested: () => captureRequested,
    onCaptureStopped: () => captureStopped,
    onTranscriptReady: noop,
  };
}

function incomingCall(): IncomingCallDto {
  return { callId: 'c1', callerUserId: 'u-ana', callerDisplayName: 'Ana', calleeUserId: 'me', kind: 'Audio', conversationId: null, ringingAtUtc: '' };
}

function configure() {
  const calls = fakeCalls();
  const toast = { info: vi.fn(), error: vi.fn(), success: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      ActiveCallService,
      { provide: CallsService, useValue: calls },
      { provide: ToastService, useValue: toast },
      { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
      { provide: MediaPolicyService, useValue: fakeMediaPolicyService() },
      { provide: SoundsService, useValue: { play: vi.fn() } },
      { provide: RecordingUploadService, useValue: { uploadAndAttach: vi.fn() } },
      { provide: SFU_CAPTURE_PUBLISHER_FACTORY, useValue: fakePublisherFactory },
    ],
  });
  const service = TestBed.inject(ActiveCallService);
  service.bindGlobalListeners();
  return { calls, toast, service, meeting: TestBed.inject(MeetingSessionState) };
}

describe('ActiveCallService (T-58 — exclusión llamada↔reunión)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('una llamada entrante durante una reunión queda bloqueada: solo se puede rechazar y nunca se captura el micrófono', async () => {
    const { calls, service, meeting, toast } = configure();
    meeting.phase.set('joined');

    calls.incoming.next(incomingCall());
    expect(service.phase()).toBe('incoming');
    expect(service.incomingBlockedByMeeting()).toBe(true);

    await service.acceptIncoming();
    expect(calls.accept).not.toHaveBeenCalled();
    expect(service.phase()).toBe('incoming');
    expect(service.localStream()).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("You're in a meeting. Leave it to take calls.");

    await service.rejectIncoming();
    expect(calls.reject).toHaveBeenCalledWith('c1');
    expect(service.phase()).toBe('idle');
  });

  it('sin reunión la llamada entrante no está bloqueada', () => {
    const { calls, service } = configure();
    calls.incoming.next(incomingCall());
    expect(service.phase()).toBe('incoming');
    expect(service.incomingBlockedByMeeting()).toBe(false);
  });

  it('no se inicia una llamada mientras hay una reunión en curso', async () => {
    const { calls, service, meeting, toast } = configure();
    meeting.phase.set('waiting');
    await service.startCall('u-ana', 'Ana', 'Audio');
    expect(calls.initiate).not.toHaveBeenCalled();
    expect(service.phase()).toBe('idle');
    expect(toast.info).toHaveBeenCalledWith("You're in a meeting. Leave it to take calls.");
  });

  it('una reunión que ya terminó no bloquea nada', () => {
    const { service, meeting } = configure();
    meeting.phase.set('ended');
    expect(service.inMeeting()).toBe(false);
  });
});

/** Sesión local mínima para la captura: pistas de salida y estado de la cámara. */
function fakeSession(videoOn: boolean) {
  const mic = { kind: 'audio', id: 'mic' } as unknown as MediaStreamTrack;
  const cam = { kind: 'video', id: 'cam' } as unknown as MediaStreamTrack;
  return {
    mic,
    cam,
    videoEnabled: signal(videoOn),
    // Lo que copia `syncFromSession` a los signals públicos.
    audioEnabled: signal(true),
    screenSharing: signal(false),
    screenAudioTrack: signal(null),
    stream: signal(null),
    screenStream: signal(null),
    muteReason: signal(null),
    videoPausedByNetwork: signal(false),
    audioOutTrack: () => mic,
    cameraOutTrack: () => cam,
    release: vi.fn(),
  };
}

interface CallInternals {
  policy: unknown;
  session: unknown;
  applyLocalTrack(source: string, track: MediaStreamTrack | null): Promise<void>;
}

describe('ActiveCallService (F7 — grabación en servidor y captura SFU D-56)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
    capture.instances.length = 0;
  });

  it('Server: no mezcla en el navegador; REC con restante; avisos de límite, LimitReached y Processing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
    const start = vi.spyOn(ClientRecordingSession.prototype, 'start').mockResolvedValue(true);
    const { calls, service, toast } = configure();
    (service as unknown as CallInternals).policy = mediaPolicyFixture();
    calls.incoming.next(incomingCall());
    calls.consentRequested.next({ callId: 'c1', requestedByUserId: 'me', requestedAtUtc: '' });
    expect(calls.respondRecordingConsent).toHaveBeenCalledWith('c1', 'Accepted');

    calls.recordingState.next({
      callId: 'c1',
      state: 'Recording',
      updatedAtUtc: '',
      captureMode: 'Server',
      startedAtUtc: '2026-10-30T11:59:30Z',
      maxDurationSeconds: 600,
    });
    expect(start).not.toHaveBeenCalled();
    expect(service.recordingElapsedLabel()).toBe('0:30');
    expect(service.recordingRemainingLabel()).toBe('9:30');

    calls.limitWarning.next({ callId: 'c1', remainingSeconds: 120, stopsAtUtc: '' });
    expect(toast.info).toHaveBeenCalledWith('Recording stops in 2 min.');

    calls.recordingState.next({ callId: 'c1', state: 'Stopping', updatedAtUtc: '', captureMode: 'Server', reason: 'LimitReached' });
    expect(toast.info).toHaveBeenCalledWith('Recording stopped (time limit reached).');
    calls.recordingState.next({ callId: 'c1', state: 'Processing', updatedAtUtc: '', captureMode: 'Server' });
    expect(service.recordingProcessing()).toBe(true);

    calls.recordingState.next({ callId: 'c1', state: 'Failed', updatedAtUtc: '', reason: 'StorageRejected' });
    expect(toast.error).toHaveBeenCalledWith('The recording could not be saved (storage limit).');
  });

  it('Client (o sin captureMode): el que pidió grabar mezcla en el navegador', () => {
    const start = vi.spyOn(ClientRecordingSession.prototype, 'start').mockResolvedValue(true);
    const { calls, service } = configure();
    (service as unknown as CallInternals).policy = mediaPolicyFixture();
    calls.incoming.next(incomingCall());
    calls.consentRequested.next({ callId: 'c1', requestedByUserId: 'me', requestedAtUtc: '' });
    calls.recordingState.next({ callId: 'c1', state: 'Recording', updatedAtUtc: '', captureMode: 'Client' });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('call.recording.start_request rechazado por el plan → copy legible', async () => {
    const { calls, service, toast } = configure();
    calls.incoming.next(incomingCall());
    service.phase.set('active');
    calls.requestRecording.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'Plan.RecordingDisabled' }));
    await service.requestRecording();
    expect(toast.error).toHaveBeenCalledWith("Recording isn't included in your plan.");
  });

  it('capture_requested publica el micro (y la cámara solo si se graba video y está encendida); sigue las pistas; capture_stopped cierra', async () => {
    const { calls, service } = configure();
    const internals = service as unknown as CallInternals;
    const session = fakeSession(true);
    internals.session = session;
    calls.incoming.next(incomingCall());

    calls.captureRequested.next({ callId: 'c1', routerRtpCapabilities: { codecs: [] }, captureVideo: true });
    await vi.waitFor(() => expect(capture.instances).toHaveLength(1));
    const publisher = capture.instances[0];
    expect(publisher.start).toHaveBeenCalledWith({ codecs: [] }, { audio: session.mic, camera: session.cam });

    // Cámara apagada (placeholder) → se deja de enviar; nueva cámara → se publica; micro nuevo → replaceTrack.
    session.videoEnabled.set(false);
    await internals.applyLocalTrack('camera', { kind: 'video', id: 'placeholder' } as unknown as MediaStreamTrack);
    expect(publisher.setTrack).toHaveBeenLastCalledWith('camera', null);
    session.videoEnabled.set(true);
    const cam2 = { kind: 'video', id: 'cam-2' } as unknown as MediaStreamTrack;
    await internals.applyLocalTrack('camera', cam2);
    expect(publisher.setTrack).toHaveBeenLastCalledWith('camera', cam2);
    const mic2 = { kind: 'audio', id: 'mic-2' } as unknown as MediaStreamTrack;
    await internals.applyLocalTrack('microphone', mic2);
    expect(publisher.setTrack).toHaveBeenLastCalledWith('audio', mic2);

    calls.captureStopped.next({ callId: 'c1' });
    expect(publisher.close).toHaveBeenCalled();
  });

  it('sin video en la grabación la cámara no se publica, y colgar cierra la captura', async () => {
    const { calls, service } = configure();
    const internals = service as unknown as CallInternals;
    internals.session = fakeSession(true);
    calls.incoming.next(incomingCall());

    calls.captureRequested.next({ callId: 'c1', routerRtpCapabilities: { codecs: [] }, captureVideo: false });
    await vi.waitFor(() => expect(capture.instances).toHaveLength(1));
    const publisher = capture.instances[0];
    expect(publisher.start).toHaveBeenCalledWith({ codecs: [] }, expect.objectContaining({ camera: null }));

    await service.endCall();
    expect(publisher.close).toHaveBeenCalled();
  });

  it('capture_requested de otra llamada o sin sesión local no arma nada', async () => {
    const { calls } = configure();
    calls.incoming.next(incomingCall());
    calls.captureRequested.next({ callId: 'otra', routerRtpCapabilities: {}, captureVideo: false });
    calls.captureRequested.next({ callId: 'c1', routerRtpCapabilities: {}, captureVideo: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(capture.instances).toHaveLength(0);
  });
});
