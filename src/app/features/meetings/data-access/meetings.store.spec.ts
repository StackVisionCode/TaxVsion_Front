import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingsStore } from './meetings.store';
import { MeetingsService } from './meetings.service';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { MeetingListItemResponse, MeetingsPageResponse } from './meeting.model';

function item(id: string): MeetingListItemResponse {
  return {
    id,
    title: 'Consulta',
    status: 'Scheduled',
    shortCode: 'ABC123',
    strategy: 'Mesh',
    hostUserId: 'host',
    scheduledForUtc: null,
    startedAtUtc: null,
    endedAtUtc: null,
    joinedParticipantsCount: 0,
    transcriptFileId: null,
  };
}

function page(items: MeetingListItemResponse[]): MeetingsPageResponse {
  return { items, page: 1, size: 20, totalCount: items.length };
}

describe('MeetingsStore realtime refresh', () => {
  let store: MeetingsStore;
  let list: ReturnType<typeof vi.fn>;
  let invited$: Subject<{ meetingId: string }>;
  let started$: Subject<{ meetingId: string }>;
  let reconnected$: Subject<void>;

  beforeEach(() => {
    invited$ = new Subject();
    started$ = new Subject();
    reconnected$ = new Subject();
    list = vi.fn().mockReturnValue(of(page([item('m1')])));

    const realtime = {
      on: (event: string) =>
        event === 'meeting.invited' ? invited$ : event === 'meeting.started' ? started$ : new Subject(),
      reconnected$,
    };

    TestBed.configureTestingModule({
      providers: [
        MeetingsStore,
        {
          provide: MeetingsService,
          useValue: { list },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'u1', permissions: [] }) } },
        { provide: CloudStorageUploadService, useValue: {} },
        { provide: CommunicationRealtimeService, useValue: realtime },
      ],
    });
    store = TestBed.inject(MeetingsStore);
  });

  it('refreshes upcoming when a meeting.invited event arrives (once loaded)', () => {
    store.bindRealtime();
    store.loadScope('upcoming');
    expect(list).toHaveBeenCalledTimes(1);

    invited$.next({ meetingId: 'm2' });
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith({ scope: 'upcoming', page: 1, size: 20 });
  });

  it('refreshes upcoming on meeting.started and on socket reconnect', () => {
    store.bindRealtime();
    store.loadScope('upcoming');
    expect(list).toHaveBeenCalledTimes(1);

    started$.next({ meetingId: 'm3' });
    reconnected$.next();
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('does NOT refresh before upcoming has been loaded (no spurious fetch)', () => {
    store.bindRealtime();
    invited$.next({ meetingId: 'm2' });
    expect(list).not.toHaveBeenCalled();
  });


  it('bindRealtime is idempotent (a second call does not double-subscribe)', () => {
    store.bindRealtime();
    store.bindRealtime();
    store.loadScope('upcoming');
    invited$.next({ meetingId: 'm2' });
    // 1 initial load + 1 refresh — not 2 refreshes from a duplicate subscription.
    expect(list).toHaveBeenCalledTimes(2);
  });
});
