import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { MailUnreadStore } from './mail-unread.store';
import { MailService } from './mail.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { UnreadMailCount } from './mail.model';

// Badge de no leídos: una ráfaga de eventos no aborta peticiones (eso deja errores en el servidor).
describe('MailUnreadStore', () => {
  function setup() {
    const responses: Array<Subject<UnreadMailCount>> = [];
    const getUnreadCount = vi.fn(() => {
      const response = new Subject<UnreadMailCount>();
      responses.push(response);
      return response;
    });
    const threadState$ = new Subject<unknown>();
    TestBed.configureTestingModule({
      providers: [
        MailUnreadStore,
        { provide: MailService, useValue: { getUnreadCount } },
        {
          provide: CommunicationRealtimeService,
          useValue: { on: (event: string) => (event === 'mail.thread_state' ? threadState$ : new Subject()) },
        },
      ],
    });
    return { store: TestBed.inject(MailUnreadStore), responses, getUnreadCount, threadState$ };
  }

  const reply = (subject: Subject<UnreadMailCount> | undefined, threads: number) => {
    subject?.next({ threads, messages: threads });
    subject?.complete();
  };

  it('agrupa los eventos que llegan con una petición en vuelo en UNA sola petición más', () => {
    const { store, responses, getUnreadCount, threadState$ } = setup();
    store.start();

    threadState$.next({});
    threadState$.next({});
    threadState$.next({});
    expect(getUnreadCount).toHaveBeenCalledTimes(1);

    reply(responses[0], 2);
    expect(getUnreadCount).toHaveBeenCalledTimes(2);
    reply(responses[1], 1);

    expect(getUnreadCount).toHaveBeenCalledTimes(2);
    expect(store.threads()).toBe(1);
  });

  it('el ajuste optimista mueve el badge sin bajar de 0', () => {
    const { store, responses } = setup();
    store.start();
    reply(responses[0], 1);

    store.adjustThreads(-1);
    store.adjustThreads(-1);

    expect(store.threads()).toBe(0);
  });
});
