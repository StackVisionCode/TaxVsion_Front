import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
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
  };
}

function configureWith(rtc: ReturnType<typeof fakeRtc>) {
  TestBed.configureTestingModule({
    providers: [
      ActiveMeetingService,
      { provide: MeetingRtcService, useValue: rtc },
      { provide: MeetingSfuService, useValue: {} },
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
