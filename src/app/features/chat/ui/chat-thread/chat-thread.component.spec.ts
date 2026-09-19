import { TestBed } from '@angular/core/testing';
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
