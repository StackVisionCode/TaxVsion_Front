import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Subject, filter, map, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { ChatService } from '../../../chat/data-access/chat.service';
import { DashboardRecentChatsComponent } from './dashboard-recent-chats.component';

describe('DashboardRecentChatsComponent — avatares', () => {
  it('un 1:1 usa la foto y el userId del par; se actualiza con user.profile.changed', () => {
    const events$ = new Subject<{ event: string; payload: unknown }>();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
        {
          provide: CommunicationRealtimeService,
          useValue: { on: (name: string) => events$.pipe(filter(e => e.event === name), map(e => e.payload)) },
        },
        {
          provide: ChatService,
          useValue: {
            listConversations: () =>
              of({
                items: [
                  {
                    id: 'c1',
                    kind: 'Direct',
                    title: null,
                    lastMessageAtUtc: '2026-10-28T10:00:00Z',
                    updatedAtUtc: '2026-10-28T10:00:00Z',
                    unreadCount: 0,
                    participants: [
                      { userId: 'me', displayName: 'Me', isPrimaryPreparer: false },
                      { userId: 'u-ana', displayName: 'Ana', isPrimaryPreparer: false, avatarFileId: 'f-ana' },
                    ],
                  },
                ],
              }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(DashboardRecentChatsComponent);
    fixture.detectChanges();
    const chat = fixture.componentInstance.chats()[0];
    expect(chat.seed).toBe('u-ana');
    expect(chat.avatarFileId).toBe('f-ana');

    events$.next({ event: 'user.profile.changed', payload: { userId: 'u-ana', avatarFileId: 'f-ana-2' } });
    expect(fixture.componentInstance.chats()[0].avatarFileId).toBe('f-ana-2');
  });
});
