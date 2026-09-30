import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveMeetingService } from './active-meeting.service';
import { MeetingRtcService } from './meeting-rtc.service';
import { MeetingSfuService } from './meeting-sfu.service';
import { CallsService } from './calls.service';
import { CallRecordingService } from './call-recording.service';
import { AuthService } from '@core/auth/auth.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { HttpClient } from '@angular/common/http';
import { MeetingJoinAck, MeetingSnapshotDto } from './meeting.model';

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
      },
    ],
    yourRole: 'Host',
    sequence: 1,
    conversationId: null, // null → no dispara loadChatHistory (sin HTTP en el test)
    ...overrides,
  };
}

/** Doble del MeetingRtcService: todos los on* devuelven Subjects inertes; join es configurable. */
function fakeRtc(joinAck: MeetingJoinAck) {
  const noop = () => new Subject();
  return {
    reconnected$: new Subject<void>(),
    join: vi.fn().mockResolvedValue(joinAck),
    onSnapshot: noop,
    onParticipantChanged: noop,
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
    onMeetingEnded: noop,
    isConnected: () => true,
    raiseHand: vi.fn(),
    chatSend: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
  };
}

function configureWith(rtc: ReturnType<typeof fakeRtc>) {
  TestBed.configureTestingModule({
    providers: [
      ActiveMeetingService,
      { provide: MeetingRtcService, useValue: rtc },
      { provide: MeetingSfuService, useValue: { leave: vi.fn() } },
      { provide: CallsService, useValue: { getIceServers: () => of({ iceServers: [] }) } },
      { provide: CallRecordingService, useValue: {} },
      { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
      { provide: ApiConfigService, useValue: { tenantUrl: (p: string) => `https://x${p}` } },
      { provide: ToastService, useValue: { info: vi.fn(), error: vi.fn(), success: vi.fn() } },
      { provide: CloudStorageUploadService, useValue: {} },
      { provide: HttpClient, useValue: { get: () => of({ items: [] }) } },
    ],
  });
  return { rtc, service: TestBed.inject(ActiveMeetingService) };
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

/** Doble con Subjects CAPTURABLES para empujar eventos del server en los tests. */
function controllableRtc(joinAck: MeetingJoinAck) {
  const base = fakeRtc(joinAck);
  const participantChanged = new Subject<unknown>();
  const chatNew = new Subject<unknown>();
  const meetingEnded = new Subject<{ meetingId: string }>();
  return {
    rtc: {
      ...base,
      onParticipantChanged: () => participantChanged,
      onChatMessageNew: () => chatNew,
      onMeetingEnded: () => meetingEnded,
    },
    participantChanged,
    chatNew,
    meetingEnded,
  };
}

function chatDto(id: string, body: string, senderId = 'other') {
  return {
    id,
    conversationId: 'c1',
    senderId,
    senderDisplayName: 'Ana',
    kind: 'Text',
    body,
    attachmentFileId: null,
    createdAtUtc: '2026-09-27T10:00:00Z',
    isEdited: false,
    isDeleted: false,
  };
}

describe('ActiveMeetingService — room lifecycle & realtime', () => {
  it('ends the room when the host ends the meeting via HTTP (meeting.ended to the personal room)', async () => {
    // Regresión "tuve que recargar para terminar": POST /end no emite meeting.state.changed a la room.
    const ctl = controllableRtc({ requiresAdmission: false, snapshot: soloSnapshot() });
    const { service } = configureWith(ctl.rtc as never);
    await service.join('m1', 'Consulta');

    ctl.meetingEnded.next({ meetingId: 'other-meeting' });
    expect(service.phase()).toBe('joined');

    ctl.meetingEnded.next({ meetingId: 'm1' });
    expect(service.phase()).toBe('ended');
  });

  it('leave() tears down locally at once even if the server never acks meeting.leave', async () => {
    const ctl = controllableRtc({ requiresAdmission: false, snapshot: soloSnapshot() });
    ctl.rtc.leave = vi.fn().mockReturnValue(new Promise(() => undefined)); // nunca responde
    const { service } = configureWith(ctl.rtc as never);
    await service.join('m1', 'Consulta');

    await service.leave();

    expect(service.phase()).toBe('idle');
    expect(service.meetingId()).toBeNull();
    expect(ctl.rtc.leave).toHaveBeenCalledWith('m1');
  });

  it('reconciles my raised hand with the server echo (participant.changed)', async () => {
    const ctl = controllableRtc({ requiresAdmission: false, snapshot: soloSnapshot() });
    const { service } = configureWith(ctl.rtc as never);
    await service.join('m1', 'Consulta');

    service.toggleHandRaise();
    expect(service.handRaised()).toBe(true);
    expect(ctl.rtc.raiseHand).toHaveBeenCalledWith('m1', true);

    // El server dice que NO está levantada (p. ej. otra pestaña la bajó): gana el server.
    ctl.participantChanged.next({
      meetingId: 'm1',
      sequence: 0,
      participant: { ...soloSnapshot().participants[0], handRaised: false },
    });
    expect(service.handRaised()).toBe(false);
    expect(service.raisedHands()).toHaveLength(0);
  });

  it('does not raise the hand (and warns) when the socket is offline', async () => {
    const ctl = controllableRtc({ requiresAdmission: false, snapshot: soloSnapshot() });
    ctl.rtc.isConnected = () => false;
    const { service } = configureWith(ctl.rtc as never);
    await service.join('m1', 'Consulta');

    service.toggleHandRaise();

    expect(service.handRaised()).toBe(false);
    expect(ctl.rtc.raiseHand).not.toHaveBeenCalled();
    expect(TestBed.inject(ToastService).error).toHaveBeenCalled();
  });

  it('routes reaction messages to floating reactions instead of the chat list', async () => {
    const ctl = controllableRtc({ requiresAdmission: false, snapshot: soloSnapshot({ conversationId: 'c1' }) });
    const { service } = configureWith(ctl.rtc as never);
    await service.join('m1', 'Consulta');

    ctl.chatNew.next(chatDto('r1', '🎉'));
    ctl.chatNew.next(chatDto('t1', 'hello'));

    expect(service.reactions().map(r => r.emoji)).toEqual(['🎉']);
    expect(service.chatMessages().map(m => m.text)).toEqual(['hello']);
    expect(service.chatMessages()[0].senderId).toBe('other');
  });

  it('sends a reaction over the meeting chat with a cooldown', async () => {
    const ctl = controllableRtc({ requiresAdmission: false, snapshot: soloSnapshot() });
    const { service } = configureWith(ctl.rtc as never);
    await service.join('m1', 'Consulta');

    service.sendReaction('👍');
    service.sendReaction('🔥'); // dentro del cooldown: ignorada
    service.sendReaction('not-a-reaction');

    expect(ctl.rtc.chatSend).toHaveBeenCalledTimes(1);
    expect(ctl.rtc.chatSend).toHaveBeenCalledWith('m1', '👍');
    expect(service.reactions()).toHaveLength(1);
    expect(service.reactions()[0].isMine).toBe(true);
  });

  it('endForAll() stays in the room and warns when the server fails', async () => {
    const ctl = controllableRtc({ requiresAdmission: false, snapshot: soloSnapshot() });
    const { service } = configureWith(ctl.rtc as never);
    const http = TestBed.inject(HttpClient) as unknown as { post: ReturnType<typeof vi.fn> };
    http.post = vi.fn().mockReturnValue(throwError(() => new Error('500')));
    await service.join('m1', 'Consulta');

    const ended = await service.endForAll();

    expect(ended).toBe(false);
    expect(service.phase()).toBe('joined');
    expect(service.ending()).toBe(false);
  });

  it('endForAll() leaves after the server confirms', async () => {
    const ctl = controllableRtc({ requiresAdmission: false, snapshot: soloSnapshot() });
    const { service } = configureWith(ctl.rtc as never);
    const http = TestBed.inject(HttpClient) as unknown as { post: ReturnType<typeof vi.fn> };
    http.post = vi.fn().mockReturnValue(of({ endedAtUtc: 'x', durationSeconds: 1 }));
    await service.join('m1', 'Consulta');

    const ended = await service.endForAll();

    expect(ended).toBe(true);
    expect(http.post).toHaveBeenCalledWith('https://x/communication/meetings/m1/end', {});
    expect(service.phase()).toBe('idle');
  });
});
