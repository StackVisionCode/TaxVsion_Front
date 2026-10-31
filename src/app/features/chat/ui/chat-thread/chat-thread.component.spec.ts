import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ChatMessage, ChatThreadComponent } from './chat-thread.component';

function msg(id: string, senderId: 'me' | 'them', extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    senderId,
    text: `text ${id}`,
    time: '10:00 AM',
    dateGroup: 'Today',
    isEdited: false,
    isDeleted: false,
    createdAtUtc: '2026-09-19T10:00:00Z',
    ...extra,
  };
}

/** jsdom no tiene layout: se simula el contenedor scrolleable (alto 300, contenido 1000). */
function fakeScroll(el: HTMLElement, scrollTop: number): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 300 });
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
}

describe('ChatThreadComponent — scroll', () => {
  function setup(messages: ChatMessage[]) {
    const fixture = TestBed.createComponent(ChatThreadComponent);
    fixture.componentRef.setInput('conversationId', 'c1');
    fixture.componentRef.setInput('messages', messages);
    fixture.detectChanges();
    const scroller = fixture.nativeElement.querySelector('[role="log"]') as HTMLElement;
    return { fixture, component: fixture.componentInstance, scroller };
  }

  it('al abrir la conversación baja al último mensaje', () => {
    const { fixture, scroller } = setup([]);
    fakeScroll(scroller, 0);
    fixture.componentRef.setInput('messages', [msg('1', 'them'), msg('2', 'them')]);
    fixture.detectChanges();
    expect(scroller.scrollTop).toBe(1000);
  });

  it('si leo más arriba y escribe el otro, no me mueve: muestra la píldora de mensajes nuevos', () => {
    const initial = [msg('1', 'them'), msg('2', 'me')];
    const { fixture, component, scroller } = setup(initial);
    fakeScroll(scroller, 100); // lejos del fondo
    component.onScroll();

    fixture.componentRef.setInput('messages', [...initial, msg('3', 'them')]);
    fixture.detectChanges();

    expect(scroller.scrollTop).toBe(100);
    expect(component.unseenCount()).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('1 new message');
  });

  it('si envío yo, SIEMPRE baja al fondo aunque estuviera leyendo más arriba', () => {
    const initial = [msg('1', 'them'), msg('2', 'them')];
    const { fixture, component, scroller } = setup(initial);
    fakeScroll(scroller, 100);
    component.onScroll();

    fixture.componentRef.setInput('messages', [...initial, msg('tmp-1', 'me', { status: 'sending' })]);
    fixture.detectChanges();

    expect(scroller.scrollTop).toBe(1000);
    expect(component.unseenCount()).toBe(0);
  });

  it('la clave de render es estable: el mensaje optimista conserva su nodo al recibir el id real', () => {
    const pending = msg('tmp-1', 'me', { status: 'sending', renderKey: 'tmp-1' });
    const { fixture } = setup([msg('1', 'them'), pending]);
    const before = fixture.nativeElement.querySelectorAll('.group')[1];

    fixture.componentRef.setInput('messages', [msg('1', 'them'), { ...pending, id: 'real-9', status: 'sent' }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.group')[1]).toBe(before);
  });

  it('un mensaje fallido ofrece reintentar', () => {
    const { fixture, component } = setup([msg('tmp-1', 'me', { status: 'failed' })]);
    const retried: string[] = [];
    component.retryRequested.subscribe(id => retried.push(id));
    const button = [...fixture.nativeElement.querySelectorAll('button')].find((b: HTMLButtonElement) =>
      b.textContent?.includes('Retry'),
    ) as HTMLButtonElement;
    button.click();
    expect(retried).toEqual(['tmp-1']);
  });
});

describe('ChatThreadComponent — avatar del remitente', () => {
  it('usa la foto vigente del participante y, si no la conoce, la del historial', () => {
    const fixture = TestBed.createComponent(ChatThreadComponent);
    fixture.componentRef.setInput('conversationId', 'g1');
    fixture.componentRef.setInput('participants', [{ userId: 'u-ana', displayName: 'Ana', avatarFileId: 'f-live' }]);
    fixture.componentRef.setInput('messages', [
      msg('1', 'them', { senderUserId: 'u-ana', senderName: 'Ana', senderAvatarFileId: 'f-old' }),
      msg('2', 'them', { senderUserId: 'u-bob', senderName: 'Bob', senderAvatarFileId: 'f-bob' }),
      msg('3', 'them', { senderUserId: 'u-eve', senderName: 'Eve' }),
    ]);
    fixture.detectChanges();

    const avatars = Array.from(fixture.nativeElement.querySelectorAll('app-avatar')) as HTMLElement[];
    const srcs = avatars.map(a => a.querySelector('img')?.getAttribute('src') ?? null);
    expect(srcs[0]).toMatch(/\/storage\/avatars\/f-live$/);
    expect(srcs[1]).toMatch(/\/storage\/avatars\/f-bob$/);
    expect(srcs[2]).toBeNull(); // sin foto: iniciales
    expect(avatars[2].textContent).toContain('EV');
  });

  it('dos ajenos seguidos de personas distintas no se agrupan', () => {
    const fixture = TestBed.createComponent(ChatThreadComponent);
    fixture.componentRef.setInput('messages', [
      msg('1', 'them', { senderUserId: 'a' }),
      msg('2', 'them', { senderUserId: 'b' }),
      msg('3', 'them', { senderUserId: 'b' }),
    ]);
    fixture.detectChanges();
    const thread = fixture.componentInstance;
    expect(thread.isContinuation(1)).toBe(false);
    expect(thread.isContinuation(2)).toBe(true);
  });
});

describe('ChatThreadComponent — F7: transcript de notas de voz, enlace al transcript y salto desde la búsqueda', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: CloudStorageUploadService, useValue: {} }] });
  });
  afterEach(() => TestBed.resetTestingModule());

  const voice = (
    id: string,
    senderId: 'me' | 'them',
    transcriptState: 'NotRequested' | 'Processing' | 'Ready' | 'Failed' | 'Skipped' | null,
    transcriptText: string | null = null,
  ) =>
    msg(id, senderId, { text: undefined, voiceNote: { fileId: `f-${id}`, durationMs: 4000, waveform: [], transcriptState, transcriptText } });

  function render(messages: ChatMessage[]) {
    const fixture = TestBed.createComponent(ChatThreadComponent);
    fixture.componentRef.setInput('conversationId', 'c1');
    fixture.componentRef.setInput('messages', messages);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('Processing → "Transcribing…", Failed → "Transcript unavailable", Skipped → nada, Ready → el texto', () => {
    const { el } = render([
      voice('1', 'them', 'Processing'),
      voice('2', 'me', 'Failed'),
      voice('3', 'them', 'Skipped'),
      voice('4', 'them', 'Ready', 'Please send me the W-2 form.'),
    ]);
    expect(el.querySelectorAll('[data-role="voice-transcript-processing"]')).toHaveLength(1);
    expect(el.querySelector('[data-role="voice-transcript-processing"]')?.textContent).toContain('Transcribing…');
    expect(el.querySelector('[data-role="voice-transcript-failed"]')?.textContent).toContain('Transcript unavailable');
    const ready = el.querySelectorAll('[data-role="voice-transcript"]');
    expect(ready).toHaveLength(1);
    expect(ready[0].textContent).toContain('Please send me the W-2 form.');
    // Corto: sin "Show more".
    expect(el.querySelector('[data-role="voice-transcript-toggle"]')).toBeNull();
  });

  it('a demanda: NotRequested muestra "Transcribe" y Failed "Try again"; ambos piden el transcript de ese mensaje', () => {
    const { fixture, el } = render([voice('1', 'them', 'NotRequested'), voice('2', 'me', 'Failed'), voice('3', 'them', 'Skipped')]);
    const requested: string[] = [];
    fixture.componentInstance.voiceTranscriptRequested.subscribe(id => requested.push(id));

    const buttons = el.querySelectorAll('[data-role="voice-transcript-request"]');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain('Transcribe');
    (buttons[0] as HTMLButtonElement).click();
    (el.querySelector('[data-role="voice-transcript-retry"]') as HTMLButtonElement).click();

    expect(requested).toEqual(['1', '2']);
  });

  it('un transcript largo se colapsa a 3 líneas con "Show more" / "Show less"', () => {
    const long = 'word '.repeat(80).trim();
    const { fixture, el } = render([voice('1', 'them', 'Ready', long)]);
    const text = () => el.querySelector('[data-role="voice-transcript"] p') as HTMLElement;
    const toggle = () => el.querySelector('[data-role="voice-transcript-toggle"]') as HTMLButtonElement;
    expect(text().classList).toContain('line-clamp-3');
    expect(toggle().textContent).toContain('Show more');

    toggle().click();
    fixture.detectChanges();
    expect(text().classList).not.toContain('line-clamp-3');
    expect(toggle().textContent).toContain('Show less');
  });

  it('un mensaje del sistema con archivo ofrece "View transcript"', () => {
    const { fixture, el } = render([msg('s1', 'them', { isSystem: true, text: 'Call transcript is ready', systemAttachmentFileId: 'f-txt' })]);
    const requested: string[] = [];
    fixture.componentInstance.transcriptRequested.subscribe(id => requested.push(id));
    (el.querySelector('[data-role="view-transcript"]') as HTMLButtonElement).click();
    expect(requested).toEqual(['f-txt']);
  });

  it('scrollToMessage salta y resalta un mensaje cargado; false si no está en el hilo', () => {
    vi.useFakeTimers();
    try {
      const { fixture, el } = render([msg('1', 'them'), msg('2', 'them')]);
      const target = el.querySelector('[data-message-id="1"]') as HTMLElement;
      const scrollIntoView = vi.fn();
      target.scrollIntoView = scrollIntoView;

      expect(fixture.componentInstance.scrollToMessage('1')).toBe(true);
      expect(scrollIntoView).toHaveBeenCalled();
      fixture.detectChanges();
      expect(target.classList).toContain('bg-amber-50');

      vi.advanceTimersByTime(3000);
      fixture.detectChanges();
      expect(target.classList).not.toContain('bg-amber-50');

      expect(fixture.componentInstance.scrollToMessage('nope')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
