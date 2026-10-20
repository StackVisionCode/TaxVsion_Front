import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import {
  NotificationDto,
  NotificationListResult,
  NotificationReadConfirmed,
  NotificationsReadAllConfirmed,
} from './notifications.model';
import { NotificationsService } from './notifications.service';
import { NotificationsStore } from './notifications.store';

const T1 = '2026-10-18T10:00:00.000Z';
const T2 = '2026-10-18T10:01:00.000Z';

function notification(id: string, createdAtUtc = T1): NotificationDto {
  return {
    id,
    kind: 'customer.created',
    priority: 'Normal',
    category: 'Clients',
    actorUserId: null,
    actorDisplayName: null,
    resourceType: 'customer',
    resourceId: id,
    resourceContext: {},
    titleKey: 'notif.customer.created.title',
    bodyKey: 'notif.customer.created.body',
    params: {},
    action: 'open',
    groupKey: null,
    title: id,
    body: 'Body',
    metadata: {},
    occurredAtUtc: createdAtUtc,
    createdAtUtc,
    readAtUtc: null,
  };
}

function page(
  items: NotificationDto[],
  unreadCount = items.length,
  asOfUtc = T1,
): NotificationListResult {
  return { items, page: 1, size: 8, unreadCount, asOfUtc };
}

describe('NotificationsStore', () => {
  let store: NotificationsStore;
  let service: {
    list: ReturnType<typeof vi.fn>;
    unreadCount: ReturnType<typeof vi.fn>;
    markRead: ReturnType<typeof vi.fn>;
    markAllRead: ReturnType<typeof vi.fn>;
  };
  let unreadChanged$: Subject<{ count: number; asOfUtc: string }>;
  let readConfirmed$: Subject<NotificationReadConfirmed>;
  let readAllConfirmed$: Subject<NotificationsReadAllConfirmed>;
  let received$: Subject<NotificationDto>;
  let reconnected$: Subject<void>;

  beforeEach(() => {
    unreadChanged$ = new Subject();
    readConfirmed$ = new Subject();
    readAllConfirmed$ = new Subject();
    received$ = new Subject();
    reconnected$ = new Subject();
    service = {
      list: vi.fn().mockReturnValue(of(page([notification('n1')]))),
      unreadCount: vi.fn().mockReturnValue(of({ count: 1, asOfUtc: T1 })),
      markRead: vi.fn().mockReturnValue(of({ notificationId: 'n1', unreadCount: 0, asOfUtc: T2 })),
      markAllRead: vi
        .fn()
        .mockReturnValue(of({ cutoffUtc: T2, markedCount: 1, unreadCount: 0, asOfUtc: T2 })),
    };
    const realtime = {
      reconnected$,
      on: <T>(event: string): Observable<T> => {
        const events: Record<string, Observable<unknown>> = {
          'notification.received': received$,
          'notification.unread_count.changed': unreadChanged$,
          'notification.read.confirmed': readConfirmed$,
          'notification.read_all.confirmed': readAllConfirmed$,
        };
        return (events[event] ?? new Subject<unknown>()) as Observable<T>;
      },
    };

    TestBed.configureTestingModule({
      providers: [
        NotificationsStore,
        { provide: NotificationsService, useValue: service },
        { provide: CommunicationRealtimeService, useValue: realtime },
      ],
    });
    store = TestBed.inject(NotificationsStore);
  });

  it('calls the atomic read-all endpoint even when the page has no loaded items', () => {
    store.markAllRead();

    expect(service.markAllRead).toHaveBeenCalledTimes(1);
    expect(store.markingAll()).toBe(false);
    expect(store.unreadCount()).toBe(0);
  });

  it('applies read confirmations emitted by another tab', () => {
    store.startRealtime();
    expect(store.recent()[0].isRead).toBe(false);

    readConfirmed$.next({ notificationId: 'n1', asOfUtc: T2 });

    expect(store.recent()[0].isRead).toBe(true);
  });

  it('resynchronizes the count and bell feed after reconnecting', () => {
    store.startRealtime();
    expect(service.list).toHaveBeenCalledTimes(1);
    expect(service.unreadCount).toHaveBeenCalledTimes(1);

    reconnected$.next();

    expect(service.list).toHaveBeenCalledTimes(2);
    expect(service.unreadCount).toHaveBeenCalledTimes(2);
  });

  it('ignores an unread count older than the latest applied snapshot', () => {
    store.startRealtime();
    unreadChanged$.next({ count: 7, asOfUtc: T2 });
    unreadChanged$.next({ count: 99, asOfUtc: T1 });

    expect(store.unreadCount()).toBe(7);
  });

  it('keeps dashboard failures separate from the notification-center state', () => {
    store.loadFirstPage();
    store.loadDashboard();

    expect(store.items()).toHaveLength(1);
    expect(store.dashboardItems()).toHaveLength(1);
    expect(store.error()).toBeNull();
    expect(store.dashboardError()).toBeNull();
  });
});
