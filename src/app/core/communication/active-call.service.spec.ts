import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveCallService } from './active-call.service';
import { CallsService } from './calls.service';
import { IncomingCallDto } from './call.model';
import { MeetingSessionState } from './meeting-session-state';
import { SoundsService } from './media/sounds.service';
import { MediaPolicyService } from './media/media-policy.service';
import { RecordingUploadService } from './media/client-recording-session';
import { fakeMediaPolicyService } from './media/testing/media-policy.fixture';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@shared/ui/toast/toast.service';

/** Doble del CallsService: cada `on*` es un Subject (los tests emiten a mano); acciones espiadas. */
function fakeCalls() {
  const incoming = new Subject<IncomingCallDto>();
  const noop = () => new Subject();
  return {
    incoming,
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
    onRecordingConsentRequested: noop,
    onRecordingConsentRecorded: noop,
    onRecordingStateChanged: noop,
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
