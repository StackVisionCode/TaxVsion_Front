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

  it('F8b: "added you to a group" abre el chat con el parámetro que lee la página', () => {
    expect(resolver.resolve(notification({ resourceType: 'conversation', resourceId: 'g1', resourceContext: {} }))).toEqual({
      commands: ['/chat'],
      queryParams: { conversation: 'g1' },
    });
  });

  it('routes unknown resource types to notification detail', () => {
    expect(resolver.resolve(notification({ resourceType: 'future_resource' }))).toEqual({
      commands: ['/notifications'],
      queryParams: { notificationId: 'notification-1' },
    });
  });

  it('routes a client form notification to the client work tab', () => {
    expect(
      resolver.resolve(
        notification({
          resourceType: 'form_request',
          resourceId: 'form-1',
          resourceContext: { customerId: 'customer-1', formRequestId: 'form-1' },
        }),
      ),
    ).toEqual({
      commands: ['/clients', 'customer-1'],
      queryParams: { tab: 'work', formRequestId: 'form-1' },
    });
  });

  it('routes an external form notification to the global inbox', () => {
    expect(
      resolver.resolve(
        notification({
          resourceType: 'form_request',
          resourceId: 'form-2',
          resourceContext: { formRequestId: 'form-2' },
        }),
      ),
    ).toEqual({
      commands: ['/client-forms'],
      queryParams: { formRequestId: 'form-2' },
    });
  });

  it('uses the same route for a push deep link and an in-app notification', () => {
    const fromInApp = resolver.resolve(
      notification({
        resourceType: 'form_request',
        resourceId: 'form-3',
        resourceContext: { customerId: 'customer-3' },
      }),
    );
    const fromPush = resolver.resolveResource('form_request', 'form-3', {
      customerId: 'customer-3',
    });

    expect(fromPush).toEqual(fromInApp);
  });
});
