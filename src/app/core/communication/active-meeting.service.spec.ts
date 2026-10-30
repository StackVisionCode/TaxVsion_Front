import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveMeetingService } from './active-meeting.service';
import { MeetingRtcService } from './meeting-rtc.service';
import { MeetingSfuService } from './meeting-sfu.service';
import { CallsService } from './calls.service';
import { ActiveCallService } from './active-call.service';
import { SoundsService } from './media/sounds.service';
import { MediaPolicyService } from './media/media-policy.service';
import { fakeMediaPolicyService } from './media/testing/media-policy.fixture';
import { AuthService } from '@core/auth/auth.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { HttpClient } from '@angular/common/http';
import { MeetingJoinAck, MeetingSnapshotDto } from './meeting.model';
import { SessionTeardownRegistry } from '@core/auth/session-teardown';

/** Snapshot mesh con un solo participante (yo) → sin peers WebRTC (evita RTCPeerConnection en jsdom). */
function soloSnapshot(overrides: Partial<MeetingSnapshotDto> = {}): MeetingSnapshotDto {
  return {
    meetingId: 'm1',
    status: 'Live',
    strategy: 'Mesh',
    hostUserId: 'me',
    isLocked: false,
    participants: [
      {
        userId: 'me',
        displayName: 'Me',
        role: 'Host',
        status: 'Joined',
        joinOrder: 0,
        audioEnabled: true,
        videoEnabled: true,
        screenSharing: false,
        handRaised: false,
        handRaisedAtUtc: null,
      },
    ],
    yourRole: 'Host',
    sequence: 1,
    conversationId: null, // null → no dispara loadChatHistory (sin HTTP en el test)
    // F3: sin tope por defecto (el reloj solo muestra transcurrido).
    scheduledDurationMinutes: null,
    maxDurationMinutes: null,
    endsAtUtc: null,
    endReason: null,
    continuationOfMeetingId: null,
    ...overrides,
  };
}

/** Doble del MeetingRtcService: todos los on* devuelven Subjects inertes; join es configurable. */
function fakeRtc(joinAck: MeetingJoinAck) {
  const noop = () => new Subject();
  return {
    reconnected$: new Subject<void>(),
    serverOffsetMs: signal(0), // F3: desfase servidor−cliente para el reloj
    join: vi.fn().mockResolvedValue(joinAck),
    mediaStatus: vi.fn(), // F1: el estado inicial de mic/cámara se publica al entrar
    leaveNoAck: vi.fn(),
    onSnapshot: noop,
    onParticipantChanged: noop,
    onParticipantQualityChanged: noop, // F4: calidad por participante
    onUserProfileChanged: noop,
    onSignalFrom: noop,
    onMutedByHost: noop,
    onChatMessageNew: noop,
    onStateChanged: noop,
    onRecordingConsentRequested: noop,
    onRecordingConsentRecorded: noop,
    onRecordingStateChanged: noop,
    onTranscriptReady: noop,
    onParticipantDenied: noop,
    onCancelled: noop,
    onDurationWarning: noop,
    onHostChanged: noop,
    onYouRemoved: noop,
    onEnded: noop,
    onHandLoweredByHost: noop, // F5
    onReactionReceived: noop, // F5
    raiseHand: vi.fn((_: string, raised: boolean) => Promise.resolve({ handRaised: raised, handRaisedAtUtc: raised ? '2026-10-30T12:00:00Z' : null })),
    react: vi.fn().mockResolvedValue(null),
    speaking: vi.fn(),
  };
}

function configureWith(rtc: ReturnType<typeof fakeRtc>, http: unknown = { get: () => of({ items: [] }) }, callPhase = 'idle') {
  const toast = { info: vi.fn(), error: vi.fn(), success: vi.fn() };
  // T-58: doble de la llamada 1:1 (idle por defecto; `endCall` la cuelga).
  const activeCall = { phase: signal(callPhase), endCall: vi.fn(async () => activeCall.phase.set('idle')) };
  TestBed.configureTestingModule({
    providers: [
      ActiveMeetingService,
      { provide: MeetingRtcService, useValue: rtc },
      { provide: MeetingSfuService, useValue: { leave: vi.fn() } },
      { provide: CallsService, useValue: { getIceServers: () => of({ iceServers: [] }) } },
      { provide: ActiveCallService, useValue: activeCall },
      { provide: SoundsService, useValue: { play: vi.fn(), isAllowed: () => true } },
      { provide: MediaPolicyService, useValue: fakeMediaPolicyService() },
      { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
      { provide: ApiConfigService, useValue: { tenantUrl: (p: string) => `https://x${p}` } },
      { provide: ToastService, useValue: toast },
      { provide: CloudStorageUploadService, useValue: {} },
      { provide: HttpClient, useValue: http },
    ],
  });
  return { rtc, toast, activeCall, service: TestBed.inject(ActiveMeetingService) };
}

function configure(joinAck: MeetingJoinAck) {
  return configureWith(fakeRtc(joinAck));
}

describe('ActiveMeetingService.join', () => {
  it('applies the snapshot from the join ack on a DIRECT join (no meeting.snapshot event needed)', async () => {
    // Regresión del cuelgue en "joining": el backend NO emite `meeting.snapshot` para el join directo,
    // el snapshot llega inline en el ack. Sin aplicarlo, la fase quedaba pegada en 'joining'.
    const { service } = configure({ requiresAdmission: false, snapshot: soloSnapshot() });

    await service.join('m1', 'Consulta');

    expect(service.phase()).toBe('joined');
    expect(service.participants()).toHaveLength(1);
    expect(service.yourRole()).toBe('Host');
  });

  it('waits in the waiting room when admission is required (snapshot applied later via event)', async () => {
    const { service } = configure({ requiresAdmission: true, snapshot: soloSnapshot() });

    await service.join('m1', 'Consulta');

    expect(service.phase()).toBe('waiting');
  });

  it('shows the passcode prompt on Meeting.InvalidPasscode and joins after submitting it', async () => {
    const rtc = fakeRtc({ requiresAdmission: false, snapshot: soloSnapshot() });
    const passcodeErr = Object.assign(new Error('Wrong passcode.'), { code: 'Meeting.InvalidPasscode' });
    rtc.join = vi
      .fn()
      .mockRejectedValueOnce(passcodeErr)
      .mockResolvedValueOnce({ requiresAdmission: false, snapshot: soloSnapshot() });
    const { service } = configureWith(rtc);

    await service.join('m1', 'Consulta');
    expect(service.phase()).toBe('passcode'); // pidió el código en vez de fallar

    await service.submitPasscode('1234');
    expect(service.phase()).toBe('joined');
    expect(rtc.join).toHaveBeenLastCalledWith('m1', { passcode: '1234' });
  });
});

describe('ActiveMeetingService (F1 — media link and resume sharing)', () => {
  it('starts with a healthy media link and offers "Resume sharing" after a full rejoin of a sharing tab', async () => {
    sessionStorage.setItem('taxvision.meeting.sharing:m1', '1');
    const { service } = configure({ requiresAdmission: false, snapshot: soloSnapshot() });

    await service.join('m1', 'Consulta');

    expect(service.mediaState()).toBe('ok');
    expect(service.screenShareInterrupted()).toBe(true);

    service.dismissResumeSharing();
    expect(service.screenShareInterrupted()).toBe(false);
    expect(sessionStorage.getItem('taxvision.meeting.sharing:m1')).toBeNull();
  });

  it('does not offer "Resume sharing" when this tab was not sharing', async () => {
    sessionStorage.removeItem('taxvision.meeting.sharing:m1');
    const { service } = configure({ requiresAdmission: false, snapshot: soloSnapshot() });

    await service.join('m1', 'Consulta');

    expect(service.screenShareInterrupted()).toBe(false);
  });
});

describe('ActiveMeetingService (mini-player support)', () => {
  it('endForAll posts /meetings/{id}/end and fully leaves without a reload', async () => {
    const rtc = { ...fakeRtc({ requiresAdmission: false, snapshot: soloSnapshot() }), leave: vi.fn().mockResolvedValue(undefined) };
    const http = { get: () => of({ items: [] }), post: vi.fn().mockReturnValue(of({ endedAtUtc: 'x', durationSeconds: 1 })) };
    const { service } = configureWith(rtc, http);
    await service.join('m1', 'Consulta');

    const ended = await service.endForAll();

    expect(ended).toBe(true);
    expect(http.post).toHaveBeenCalledWith('https://x/communication/meetings/m1/end', {});
    expect(rtc.leave).toHaveBeenCalledWith('m1');
    expect(service.phase()).toBe('idle');
    expect(service.localStream()).toBeNull();
  });

  it('endForAll stays in the meeting when the backend rejects it', async () => {
    const rtc = { ...fakeRtc({ requiresAdmission: false, snapshot: soloSnapshot() }), leave: vi.fn().mockResolvedValue(undefined) };
    const http = { get: () => of({ items: [] }), post: vi.fn().mockReturnValue(throwError(() => new Error('nope'))) };
    const { service } = configureWith(rtc, http);
    await service.join('m1', 'Consulta');

    expect(await service.endForAll()).toBe(false);
    expect(service.phase()).toBe('joined');
    expect(rtc.leave).not.toHaveBeenCalled();
  });

  it('treats being removed by the host as the end of the meeting, and closeEnded resets to idle', async () => {
    const changed = new Subject<unknown>();
    const rtc = { ...fakeRtc({ requiresAdmission: false, snapshot: soloSnapshot() }), onParticipantChanged: () => changed };
    const { service } = configureWith(rtc);
    await service.join('m1', 'Consulta');
    service.pinnedUserId.set('someone');

    changed.next({ meetingId: 'm1', participant: { ...soloSnapshot().participants[0], status: 'Removed' } });

    expect(service.phase()).toBe('ended');
    expect(service.errorMessage()).toBe('You were removed from the meeting.');
    service.closeEnded();
    expect(service.phase()).toBe('idle');
    expect(service.pinnedUserId()).toBeNull();
  });

  it('keeps participant photos across media-only changes and applies user.profile.changed', async () => {
    const changed = new Subject<unknown>();
    const profile = new Subject<unknown>();
    const snapshot = soloSnapshot();
    snapshot.participants[0] = { ...snapshot.participants[0], avatarFileId: 'f-me' };
    const rtc = {
      ...fakeRtc({ requiresAdmission: false, snapshot }),
      onParticipantChanged: () => changed,
      onUserProfileChanged: () => profile,
    };
    const { service } = configureWith(rtc);
    await service.join('m1', 'Consulta');
    expect(service.participants()[0].avatarFileId).toBe('f-me');

    // participant.changed de media llega sin foto: se conserva.
    const { avatarFileId: _omit, ...withoutPhoto } = snapshot.participants[0];
    changed.next({ meetingId: 'm1', participant: { ...withoutPhoto, audioEnabled: false } });
    expect(service.participants()[0]).toMatchObject({ audioEnabled: false, avatarFileId: 'f-me' });

    profile.next({ userId: 'me', displayName: 'Me', avatarFileId: 'f-me-2' });
    expect(service.participants()[0].avatarFileId).toBe('f-me-2');
  });
});

describe('ActiveMeetingService (F3 — role, clock, lifecycle and session)', () => {
  afterEach(() => vi.useRealTimers());

  function withEvents() {
    const participantChanged = new Subject<unknown>();
    const hostChanged = new Subject<unknown>();
    const stateChanged = new Subject<unknown>();
    const youRemoved = new Subject<unknown>();
    const durationWarning = new Subject<unknown>();
    const ended = new Subject<unknown>();
    const rtc = {
      ...fakeRtc({ requiresAdmission: false, snapshot: soloSnapshot() }),
      leave: vi.fn().mockResolvedValue(undefined),
      onParticipantChanged: () => participantChanged,
      onHostChanged: () => hostChanged,
      onStateChanged: () => stateChanged,
      onYouRemoved: () => youRemoved,
      onDurationWarning: () => durationWarning,
      onEnded: () => ended,
    };
    return { rtc, participantChanged, hostChanged, stateChanged, youRemoved, durationWarning, ended };
  }

  it('recomputes my role from participant.changed and host.changed, and state.changed does not revert it', async () => {
    const ev = withEvents();
    const { service } = configureWith(ev.rtc);
    await service.join('m1', 'Consulta');
    expect(service.yourRole()).toBe('Host');

    // Transferí el host a "other": primero los dos participant.changed (yo Cohost, other Host)…
    const me = soloSnapshot().participants[0];
    ev.participantChanged.next({ meetingId: 'm1', participant: { ...me, role: 'Cohost' } });
    expect(service.yourRole()).toBe('Cohost');
    expect(service.canEndForAll()).toBe(true); // D-07: el cohost también termina
    expect(service.isPrimaryHost()).toBe(false);

    // …luego host.changed y por último state.changed con el hostUserId real: el rol NO se revierte.
    ev.hostChanged.next({ meetingId: 'm1', previousHostUserId: 'me', newHostUserId: 'other', reason: 'Transfer' });
    ev.stateChanged.next({ meetingId: 'm1', status: 'Live', isLocked: false, hostUserId: 'other', sequence: 5 });
    expect(service.yourRole()).toBe('Cohost');
    expect(service.hostUserId()).toBe('other');

    // Me devuelven el host.
    ev.hostChanged.next({ meetingId: 'm1', previousHostUserId: 'other', newHostUserId: 'me', reason: 'Succession' });
    expect(service.yourRole()).toBe('Host');
    expect(service.isPrimaryHost()).toBe(true);
  });

  it('counts down against the SERVER clock (offset from emittedAtUtc) and formats elapsed / remaining', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
    const ev = withEvents();
    const { service } = configureWith(ev.rtc);
    // Vence a las 12:10 del servidor; el navegador va 30 s atrasado → al servidor le quedan 570 s.
    ev.rtc.join.mockResolvedValue({
      requiresAdmission: false,
      snapshot: soloSnapshot({ endsAtUtc: '2026-10-29T12:10:00Z', maxDurationMinutes: 60 }),
    });
    ev.rtc.serverOffsetMs.set(30_000);

    await service.join('m1', 'Consulta');

    expect(service.remainingSeconds()).toBe(570);
    expect(service.elapsedSeconds()).toBe(60 * 60 - 570);
    expect(service.clockLabel()).toBe('50:30 / 09:30');

    vi.advanceTimersByTime(10_000);
    expect(service.remainingSeconds()).toBe(560);

    // Aviso de umbral: persiste y actualiza el corte.
    ev.durationWarning.next({ meetingId: 'm1', remainingSeconds: 300, endsAtUtc: '2026-10-29T12:10:00Z' });
    expect(service.durationWarning()?.remainingSeconds).toBe(300);
  });

  it('shows only the elapsed time when the server sends no endsAtUtc', async () => {
    const ev = withEvents();
    const { service } = configureWith(ev.rtc);
    await service.join('m1', 'Consulta');

    expect(service.remainingSeconds()).toBeNull();
    expect(service.clockLabel()).toMatch(/^\d{2}:\d{2}$/);
  });

  it('ends with the server reason, stops media, and lets the host start a continuation', async () => {
    const ev = withEvents();
    const http = {
      get: () => of({ items: [] }),
      post: vi.fn((url: string) =>
        url.endsWith('/continue') ? of({ meetingId: 'm2', shortCode: 'XYZ', requiresPasscode: false, invitationsCreated: 2 }) : of({}),
      ),
    };
    const { service } = configureWith(ev.rtc, http);
    await service.join('m1', 'Consulta');

    ev.stateChanged.next({ meetingId: 'm1', status: 'Ended', isLocked: false, hostUserId: 'me', sequence: 9, endReason: 'MaxDurationReached' });

    expect(service.phase()).toBe('ended');
    expect(service.meetingEnded()).toBe(true);
    expect(service.endedTitle()).toBe('Meeting ended: time limit reached');
    expect(service.localStream()).toBeNull();
    // meeting.ended duplicado: idempotente.
    ev.ended.next({ meetingId: 'm1', reason: 'MaxDurationReached' });
    expect(service.phase()).toBe('ended');

    ev.rtc.join.mockResolvedValue({ requiresAdmission: false, snapshot: soloSnapshot({ meetingId: 'm2' }) });
    expect(await service.startContinuation()).toBe(true);
    expect(http.post).toHaveBeenCalledWith('https://x/communication/meetings/m1/continue', {});
    expect(http.post).toHaveBeenCalledWith('https://x/communication/meetings/m2/start', {});
    expect(ev.rtc.join).toHaveBeenLastCalledWith('m2', undefined);
    expect(service.meetingId()).toBe('m2');
    expect(service.meetingTitle()).toBe('Consulta (cont.)');
    expect(service.phase()).toBe('joined');
  });

  it('a cancellation is a notice without continuation', async () => {
    const ev = withEvents();
    const { service } = configureWith(ev.rtc);
    await service.join('m1', 'Consulta');
    ev.stateChanged.next({ meetingId: 'm1', status: 'Cancelled', isLocked: false, hostUserId: 'me', sequence: 2 });
    expect(service.phase()).toBe('ended');
    expect(service.meetingEnded()).toBe(false);
    expect(service.endedTitle()).toBe('This meeting was cancelled.');
    expect(await service.startContinuation()).toBe(false);
  });

  it('meeting.you.removed leaves locally with a toast and WITHOUT sending meeting.leave', async () => {
    const ev = withEvents();
    const { service, toast } = configureWith(ev.rtc);
    await service.join('m1', 'Consulta');

    ev.youRemoved.next({ meetingId: 'm1', reason: 'RemovedByHost' });

    expect(service.phase()).toBe('idle');
    expect(service.meetingId()).toBeNull();
    expect(service.localStream()).toBeNull();
    expect(toast.info).toHaveBeenCalledWith('You were removed by the host');
    expect(ev.rtc.leave).not.toHaveBeenCalled();

    // Ya fuera: un segundo aviso no hace nada.
    ev.youRemoved.next({ meetingId: 'm1', reason: 'Grace' });
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it('shows the ack code of a host action as readable copy (no timeout guessing)', async () => {
    const ev = withEvents();
    const err = Object.assign(new Error('nope'), { code: 'Meeting.Role.NotEligible' });
    const rtc = { ...ev.rtc, transferHost: vi.fn().mockRejectedValue(err) };
    const { service, toast } = configureWith(rtc);
    await service.join('m1', 'Consulta');

    service.transferHost('client-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(toast.error).toHaveBeenCalledWith('Clients and guests cannot be made host or co-host.');
  });

  it('pagehide sends a fire-and-forget meeting.leave once while inside as a participant', async () => {
    const ev = withEvents();
    const { service } = configureWith(ev.rtc);
    await service.join('m1', 'Consulta');
    ev.hostChanged.next({ meetingId: 'm1', previousHostUserId: 'me', newHostUserId: 'other', reason: 'Transfer' });
    expect(service.isPrimaryHost()).toBe(false);

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));

    expect(ev.rtc.leaveNoAck).toHaveBeenCalledTimes(1);
    expect(ev.rtc.leaveNoAck).toHaveBeenCalledWith('m1');
  });

  it('pagehide does not send meeting.leave for the host (grace + succession on the server)', async () => {
    const ev = withEvents();
    const { service } = configureWith(ev.rtc);
    await service.join('m1', 'Consulta');
    expect(service.isPrimaryHost()).toBe(true);

    window.dispatchEvent(new Event('pagehide'));

    expect(ev.rtc.leaveNoAck).not.toHaveBeenCalled();
  });

  it('logging out tears the meeting down through the session teardown registry', async () => {
    const ev = withEvents();
    const { service } = configureWith(ev.rtc);
    await service.join('m1', 'Consulta');

    TestBed.inject(SessionTeardownRegistry).runAll();

    expect(service.phase()).toBe('idle');
    expect(ev.rtc.leave).toHaveBeenCalledWith('m1');
  });
});

describe('ActiveMeetingService (T-58 — exclusión llamada↔reunión)', () => {
  it('join() con una llamada en curso no entra: toast "already in a call" con "Leave and join" que cuelga y entra', async () => {
    const rtc = fakeRtc({ requiresAdmission: false, snapshot: soloSnapshot() });
    const { service, toast, activeCall } = configureWith(rtc, undefined, 'active');

    await service.join('m1', 'Consulta', { audio: false });

    expect(service.phase()).toBe('idle');
    expect(rtc.join).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("You're already in a call.", expect.objectContaining({ action: expect.objectContaining({ label: 'Leave and join' }) }));

    const action = (toast.info.mock.calls[0][1] as { action: { run: () => void } }).action;
    action.run();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(activeCall.endCall).toHaveBeenCalledTimes(1);
    expect(rtc.join).toHaveBeenCalledWith('m1', undefined);
    expect(service.phase()).toBe('joined');
  });

  it('sin llamada en curso entra con normalidad', async () => {
    const rtc = fakeRtc({ requiresAdmission: false, snapshot: soloSnapshot() });
    const { service, toast } = configureWith(rtc);
    await service.join('m1', 'Consulta');
    expect(service.phase()).toBe('joined');
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe('ActiveMeetingService (F5 — manos D-49)', () => {
  function withHands() {
    const participantChanged = new Subject<unknown>();
    const loweredByHost = new Subject<unknown>();
    const rtc = {
      ...fakeRtc({ requiresAdmission: false, snapshot: soloSnapshot() }),
      rejoin: vi.fn(),
      lowerHand: vi.fn().mockResolvedValue({}),
      onParticipantChanged: () => participantChanged,
      onHandLoweredByHost: () => loweredByHost,
    };
    return { rtc, participantChanged, loweredByHost };
  }

  it('levanta la mano en optimista, el ack fija handRaisedAtUtc y mi fila del roster entra en la cola', async () => {
    const h = withHands();
    const { service } = configureWith(h.rtc);
    await service.join('m1', 'Consulta');

    const pending = service.toggleHandRaise();
    expect(service.handRaised()).toBe(true); // optimista
    await pending;
    expect(h.rtc.raiseHand).toHaveBeenCalledWith('m1', true);
    expect(service.handRaisedAtUtc()).toBe('2026-10-30T12:00:00Z');
    expect(service.raisedHands().map(p => p.userId)).toEqual(['me']);
    expect(service.raisedHandCount()).toBe(1);
    expect(service.selfParticipant().handRaised).toBe(true);
  });

  it('si el servidor rechaza la mano vuelve atrás con el motivo', async () => {
    const h = withHands();
    h.rtc.raiseHand = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'Meeting.NotParticipant' }));
    const { service, toast } = configureWith(h.rtc);
    await service.join('m1', 'Consulta');

    await service.toggleHandRaise();

    expect(service.handRaised()).toBe(false);
    expect(service.raisedHandCount()).toBe(0);
    expect(toast.error).toHaveBeenCalledWith("You're not in this meeting anymore.");
  });

  it('tras reconnected$ reenvía mi último estado si el snapshot del rejoin difiere (la reconexión conserva la mano)', async () => {
    const h = withHands();
    const { service } = configureWith(h.rtc);
    await service.join('m1', 'Consulta');
    await service.toggleHandRaise();
    h.rtc.raiseHand.mockClear();

    // El servidor perdió la mano: el snapshot del rejoin me trae handRaised=false.
    h.rtc.rejoin.mockResolvedValue({ snapshot: soloSnapshot() });
    h.rtc.reconnected$.next();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.rtc.raiseHand).toHaveBeenCalledWith('m1', true);
    expect(service.handRaised()).toBe(true);

    // Snapshot coherente con lo pedido: no se reenvía nada.
    h.rtc.raiseHand.mockClear();
    const raised = soloSnapshot();
    raised.participants[0] = { ...raised.participants[0], handRaised: true, handRaisedAtUtc: '2026-10-30T12:00:00Z' };
    h.rtc.rejoin.mockResolvedValue({ snapshot: raised });
    h.rtc.reconnected$.next();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.rtc.raiseHand).not.toHaveBeenCalled();
  });

  it('meeting.hand.lowered_by_host baja mi mano con toast (una / todas)', async () => {
    const h = withHands();
    const { service, toast } = configureWith(h.rtc);
    await service.join('m1', 'Consulta');
    await service.toggleHandRaise();

    h.loweredByHost.next({ meetingId: 'm1', byUserId: 'host', all: false });
    expect(service.handRaised()).toBe(false);
    expect(toast.info).toHaveBeenCalledWith('The host lowered your hand.');
    h.loweredByHost.next({ meetingId: 'm1', byUserId: 'host', all: true });
    expect(toast.info).toHaveBeenCalledWith('The host lowered all hands.');
  });

  it('el ack de meeting.join con handLoweredOnRejoin avisa que la mano se bajó al salir', async () => {
    const rtc = fakeRtc({ requiresAdmission: false, snapshot: soloSnapshot(), rejoined: true, handLoweredOnRejoin: true });
    const { service, toast } = configureWith(rtc);
    await service.join('m1', 'Consulta');
    expect(service.handRaised()).toBe(false);
    expect(toast.info).toHaveBeenCalledWith('Your hand was lowered when you left.');
  });

  it('solo host/cohost reciben sonido + toast cuando otro levanta la mano; la cola se ordena por tiempo; lowerHand usa el ack real', async () => {
    const h = withHands();
    const { service, toast } = configureWith(h.rtc);
    const sounds = TestBed.inject(SoundsService) as unknown as { play: ReturnType<typeof vi.fn> };
    await service.join('m1', 'Consulta'); // soy Host
    const other = { ...soloSnapshot().participants[0], userId: 'u2', displayName: 'Bo', role: 'Attendee' as const, joinOrder: 1 };
    h.participantChanged.next({ meetingId: 'm1', participant: other });
    sounds.play.mockClear();

    h.participantChanged.next({ meetingId: 'm1', participant: { ...other, handRaised: true, handRaisedAtUtc: '2026-10-30T12:02:00Z' } });
    expect(sounds.play).toHaveBeenCalledWith('notification', expect.anything());
    expect(toast.info).toHaveBeenCalledWith('Bo raised their hand');

    await service.toggleHandRaise(); // la mía a las 12:00 → va primero
    expect(service.raisedHands().map(p => p.userId)).toEqual(['me', 'u2']);

    service.performHostAction('lowerHand', 'u2');
    expect(h.rtc.lowerHand).toHaveBeenCalledWith('m1', 'u2');
  });
});

describe('ActiveMeetingService (F5 — reacciones D-50 y hablante T-69)', () => {
  afterEach(() => vi.useRealTimers());

  function withReactions() {
    const received = new Subject<unknown>();
    const rtc = { ...fakeRtc({ requiresAdmission: false, snapshot: soloSnapshot() }), onReactionReceived: () => received };
    return { rtc, received };
  }

  it('una reacción recibida pinta la burbuja del participante, la anuncia y vence a los durationSeconds de la política', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
    const r = withReactions();
    const { service } = configureWith(r.rtc);
    await service.join('m1', 'Consulta');
    expect(service.reactionsEnabled()).toBe(true);

    r.received.next({ meetingId: 'm1', userId: 'u2', displayName: 'Bo', emoji: '👏', at: '2026-10-30T12:00:00Z' });
    expect(service.reactions()).toHaveLength(1);
    expect(service.reactionByUser().get('u2')?.emoji).toBe('👏');
    expect(service.reactionAnnouncement()).toBe('Bo reacted 👏');
    expect(service.chatMessages()).toEqual([]); // nunca al chat

    vi.advanceTimersByTime(4500); // política: 4 s
    expect(service.reactions()).toEqual([]);
  });

  it('mi reacción se pinta al ack y el broadcast propio no la duplica; el código del ack va a toast', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
    const r = withReactions();
    const { service, toast } = configureWith(r.rtc);
    await service.join('m1', 'Consulta');

    await service.react('🔥');
    expect(r.rtc.react).toHaveBeenCalledWith('m1', '🔥');
    expect(service.reactions()).toHaveLength(1);
    expect(service.reactionAnnouncement()).toBe('You reacted 🔥');
    r.received.next({ meetingId: 'm1', userId: 'me', displayName: 'Me', emoji: '🔥', at: '2026-10-30T12:00:00.200Z' });
    expect(service.reactions()).toHaveLength(1);

    r.rtc.react = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'Meeting.ReactionRateLimited' }));
    await service.react('👍');
    expect(toast.error).toHaveBeenCalledWith("You're reacting too fast. Give it a moment.");
  });

  it('reportSpeaking emite meeting.speaking solo al cambiar y acotado por speaking.maxPerSecond', async () => {
    vi.useFakeTimers();
    const r = withReactions();
    const { service } = configureWith(r.rtc);
    await service.join('m1', 'Consulta');

    service.reportSpeaking(true);
    service.reportSpeaking(true); // sin cambio: nada
    service.reportSpeaking(false);
    expect(r.rtc.speaking.mock.calls).toEqual([
      ['m1', true],
      ['m1', false],
    ]);
    // Política del fixture: 5 por segundo → la sexta queda pendiente y sale al liberarse la ventana.
    service.reportSpeaking(true);
    service.reportSpeaking(false);
    service.reportSpeaking(true);
    service.reportSpeaking(false);
    expect(r.rtc.speaking).toHaveBeenCalledTimes(5);
    vi.advanceTimersByTime(1000);
    expect(r.rtc.speaking).toHaveBeenCalledTimes(6);
    expect(r.rtc.speaking).toHaveBeenLastCalledWith('m1', false);
  });

  it('cuenta los mensajes ajenos con el chat cerrado y markChatRead los limpia', async () => {
    const chat = new Subject<unknown>();
    const rtc = { ...fakeRtc({ requiresAdmission: false, snapshot: soloSnapshot({ conversationId: 'c1' }) }), onChatMessageNew: () => chat };
    const { service } = configureWith(rtc);
    await service.join('m1', 'Consulta');
    const msg = { id: 'x1', conversationId: 'c1', senderId: 'u2', senderDisplayName: 'Bo', kind: 'Text', body: 'hi', attachmentFileId: null, createdAtUtc: '2026-10-30T12:00:00Z', isEdited: false, isDeleted: false };
    chat.next(msg);
    chat.next({ ...msg, id: 'x2', senderId: 'me' });
    expect(service.chatUnread()).toBe(1);
    service.chatPanelOpen.set(true);
    chat.next({ ...msg, id: 'x3' });
    expect(service.chatUnread()).toBe(1);
    service.markChatRead();
    expect(service.chatUnread()).toBe(0);
  });
});

describe('ActiveMeetingService.joinAsGuest (F6, D-47)', () => {
  it('entra como guest:{invitationId} con el ICE del ack, sin pedir ICE por HTTP ni historial de chat', async () => {
    const youRemoved = new Subject<unknown>();
    const snapshot = soloSnapshot({ hostUserId: 'host', conversationId: 'c1' });
    snapshot.participants = [{ ...snapshot.participants[0], userId: 'guest:inv-1', role: 'Attendee', actorType: 'Guest' }];
    snapshot.yourRole = 'Attendee';
    const rtc = {
      ...fakeRtc({ requiresAdmission: false, snapshot, iceServers: { iceServers: [{ urls: 'turn:turn.example' }], expiresAtUtc: 'x' } }),
      leave: vi.fn().mockResolvedValue(undefined),
      onYouRemoved: () => youRemoved,
    };
    const httpGet = vi.fn().mockReturnValue(of({ items: [] }));
    const { service } = configureWith(rtc, { get: httpGet });
    const ice = TestBed.inject(CallsService) as { getIceServers: () => unknown };
    const iceSpy = vi.spyOn(ice, 'getIceServers');

    await service.joinAsGuest('m1', 'Consulta', 'inv-1', { audio: true, video: false });

    expect(service.phase()).toBe('joined');
    expect(service.isGuest()).toBe(true);
    expect(service.myUserId()).toBe('guest:inv-1');
    expect(service.isHost()).toBe(false);
    expect(rtc.join).toHaveBeenCalledWith('m1', { guestInvitationId: 'inv-1' });
    expect(iceSpy).not.toHaveBeenCalled(); // sin JWT: el ICE viene en el ack
    expect(httpGet).not.toHaveBeenCalled(); // sin historial de chat autenticado

    // El host revocó la invitación: salida local con el motivo disponible para la página pública.
    youRemoved.next({ meetingId: 'm1', reason: 'Revoked' });
    expect(service.phase()).toBe('idle');
    expect(service.removedReason()).toBe('Revoked');
    expect(service.isGuest()).toBe(false);
    expect(rtc.leave).not.toHaveBeenCalled();
  });

  it('el guest respeta la sala de espera forzada por la oficina', async () => {
    const rtc = fakeRtc({ requiresAdmission: true, snapshot: soloSnapshot() });
    const { service } = configureWith(rtc);
    await service.joinAsGuest('m1', 'Consulta', 'inv-2');
    expect(service.phase()).toBe('waiting');
    expect(service.myUserId()).toBe('guest:inv-2');
  });
});
