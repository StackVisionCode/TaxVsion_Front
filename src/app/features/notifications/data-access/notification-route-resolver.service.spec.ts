import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppNotification } from '../ui/notification-list/notification-list.component';
import { NotificationRouteResolver } from './notification-route-resolver.service';

function notification(patch: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'notification-1',
    kind: 'correspondence.customer_email_received',
    type: 'general',
    priority: 'Normal',
    category: 'Mail',
    title: 'New email',
    message: 'Open the conversation.',
    time: 'now',
    createdAtUtc: '2026-10-19T10:00:00Z',
    occurredAtUtc: '2026-10-19T10:00:00Z',
    createdAt: Date.parse('2026-10-19T10:00:00Z'),
    actorUserId: null,
    actorDisplayName: null,
    actorType: null,
    resourceType: 'email_thread',
    resourceId: 'thread-1',
    resourceContext: { accountId: 'account-1', customerId: 'customer-1', messageId: 'message-1' },
    action: 'open',
    metadata: {},
    isRead: false,
    ...patch,
  };
}

describe('NotificationRouteResolver', () => {
  let resolver: NotificationRouteResolver;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: { navigate: vi.fn() } }],
    });
    resolver = TestBed.inject(NotificationRouteResolver);
  });

  it('builds the complete mail deep link', () => {
    expect(resolver.resolve(notification())).toEqual({
      commands: ['/email'],
      queryParams: {
        accountId: 'account-1',
        customerId: 'customer-1',
        threadId: 'thread-1',
        messageId: 'message-1',
      },
    });
  });

  it('routes unknown resource types to notification detail', () => {
    expect(resolver.resolve(notification({ resourceType: 'future_resource' }))).toEqual({
      commands: ['/notifications'],
      queryParams: { notificationId: 'notification-1' },
    });
  });
});
