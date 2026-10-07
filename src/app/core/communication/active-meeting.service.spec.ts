import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveMeetingService } from './active-meeting.service';
import { MeetingSoundsService } from './meeting-sounds.service';
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
  };
}

function configureWith(rtc: ReturnType<typeof fakeRtc>, http: unknown = { get: () => of({ items: [] }) }) {
  TestBed.configureTestingModule({
    providers: [
      ActiveMeetingService,
      { provide: MeetingRtcService, useValue: rtc },
      { provide: MeetingSfuService, useValue: { leave: vi.fn() } },
      { provide: CallsService, useValue: { getIceServers: () => of({ iceServers: [] }) } },
      { provide: CallRecordingService, useValue: {} },
      { provide: MeetingSoundsService, useValue: { play: vi.fn() } },
      { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
      { provide: ApiConfigService, useValue: { tenantUrl: (p: string) => `https://x${p}` } },
      { provide: ToastService, useValue: { info: vi.fn(), error: vi.fn(), success: vi.fn() } },
      { provide: CloudStorageUploadService, useValue: {} },
      { provide: HttpClient, useValue: http },
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
});
