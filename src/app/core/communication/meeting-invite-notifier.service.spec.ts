import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { MeetingInviteNotifierService } from './meeting-invite-notifier.service';

describe('MeetingInviteNotifierService (F6)', () => {
  let service: MeetingInviteNotifierService;
  let invited$: Subject<unknown>;
  let reminder$: Subject<unknown>;
  const toast = { info: vi.fn() };
  const router = { navigate: vi.fn().mockResolvedValue(true) };

  beforeEach(() => {
    toast.info.mockReset();
    router.navigate.mockReset();
    invited$ = new Subject();
    reminder$ = new Subject();
    TestBed.configureTestingModule({
      providers: [
        MeetingInviteNotifierService,
        {
          provide: CommunicationRealtimeService,
          useValue: { on: (event: string) => (event === 'meeting.invited' ? invited$ : event === 'meeting.reminder' ? reminder$ : new Subject()) },
        },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
      ],
    });
    service = TestBed.inject(MeetingInviteNotifierService);
    service.start(TestBed.inject(DestroyRef));
  });

  it('meeting.invited en vivo → toast con "Join" que lleva al lobby de esa reunión', () => {
    invited$.next({ meetingId: 'm1', title: 'Weekly', status: 'Live', invitedByUserId: 'u1', invitedByDisplayName: 'Ana Pérez' });

    expect(toast.info).toHaveBeenCalledTimes(1);
    const [message, options] = toast.info.mock.calls[0] as [string, { action: { label: string; run: () => void } }];
    expect(message).toBe('Ana Pérez invited you to a meeting in progress');
    expect(options.action.label).toBe('Join');
    options.action.run();
    expect(router.navigate).toHaveBeenCalledWith(['/meetings'], { queryParams: { join: 'm1' } });
  });

  it('una invitación a una reunión agendada no levanta toast (va por correo/in-app y a la agenda)', () => {
    invited$.next({ meetingId: 'm2', title: 'Later', status: 'Scheduled', invitedByUserId: 'u1', invitedByDisplayName: 'Ana' });
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('meeting.reminder → "starts in N min" con "Join"', () => {
    reminder$.next({ meetingId: 'm3', title: 'Tax review', scheduledForUtc: '2026-10-30T15:00:00Z', minutesBefore: 15 });

    const [message, options] = toast.info.mock.calls[0] as [string, { action: { label: string; run: () => void } }];
    expect(message).toBe('Tax review starts in 15 min');
    options.action.run();
    expect(router.navigate).toHaveBeenCalledWith(['/meetings'], { queryParams: { join: 'm3' } });
  });

  it('start es idempotente', () => {
    service.start(TestBed.inject(DestroyRef));
    invited$.next({ meetingId: 'm1', title: 'Weekly', status: 'Live', invitedByUserId: 'u1', invitedByDisplayName: 'Ana' });
    expect(toast.info).toHaveBeenCalledTimes(1);
  });
});
