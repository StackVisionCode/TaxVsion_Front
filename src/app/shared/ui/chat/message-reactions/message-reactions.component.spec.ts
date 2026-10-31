import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { MessageReactionsComponent } from './message-reactions.component';
import { applyReaction, hasMyReaction, reactionErrorText } from './reaction-summary';
import { linkifySegments, MESSAGE_MAX_LENGTH } from '../message-text';

/** F8d — reacciones (chips, barra rápida, tope D-24, quién reaccionó) y texto con enlaces seguros. */
describe('MessageReactionsComponent', () => {
  const catalog = ['👍', '❤️', '😂', '😮', '🎉', '🙏', '🤔', '✅'];

  function render(over: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({ providers: [{ provide: CloudStorageUploadService, useValue: {} }] });
    const fixture = TestBed.createComponent(MessageReactionsComponent);
    const inputs = {
      reactions: [
        { emoji: '👍', count: 2, userIds: ['me', 'ana'] },
        { emoji: '😂', count: 1, userIds: ['ana'] },
      ],
      catalog,
      participants: [{ userId: 'ana', displayName: 'Ana' }, { userId: 'me', displayName: 'Me' }],
      currentUserId: 'me',
      canReact: true,
      maxPerUser: 3,
      ...over,
    };
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('chips con contador y aria-pressed en las mías; clic emite el emoji', () => {
    const { fixture, el } = render();
    const chips = el.querySelectorAll<HTMLButtonElement>('[data-role="reaction-chip"]');
    expect(chips).toHaveLength(2);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
    expect(chips[1].getAttribute('aria-pressed')).toBe('false');
    expect(chips[0].textContent?.replace(/\s+/g, '')).toBe('👍2');
    const toggled: string[] = [];
    fixture.componentInstance.toggled.subscribe(e => toggled.push(e));
    chips[1].click();
    expect(toggled).toEqual(['😂']);
  });

  it('"quién reaccionó" muestra nombres (y "You")', () => {
    const { el } = render();
    expect(el.querySelector('[data-role="reaction-who"]')?.textContent).toContain('You');
    expect(el.querySelector('[data-role="reaction-who"]')?.textContent).toContain('Ana');
  });

  it('la barra rápida ofrece los primeros 6 y, con el tope alcanzado, deshabilita los nuevos', () => {
    const { fixture, el } = render({
      reactions: [
        { emoji: '👍', count: 1, userIds: ['me'] },
        { emoji: '❤️', count: 1, userIds: ['me'] },
        { emoji: '😂', count: 1, userIds: ['me'] },
      ],
    });
    el.querySelector<HTMLButtonElement>('[data-role="reaction-add"]')?.click();
    fixture.detectChanges();
    const quick = el.querySelectorAll<HTMLButtonElement>('[data-role="reaction-bar"] > button');
    expect(quick).toHaveLength(6);
    expect(quick[0].disabled).toBe(false); // 👍 ya es mío: se puede quitar
    expect(quick[3].disabled).toBe(true); // 😮 nuevo con 3 puestos
  });

  it('sin permiso para reaccionar no hay botón de agregar', () => {
    const { el } = render({ canReact: false });
    expect(el.querySelector('[data-role="reaction-add"]')).toBeNull();
  });
});

describe('reaction-summary', () => {
  it('agrega, es idempotente y quita el chip que queda en cero', () => {
    let list = applyReaction([], { emoji: '👍', userId: 'a' }, 1);
    list = applyReaction(list, { emoji: '👍', userId: 'a' }, 1);
    list = applyReaction(list, { emoji: '👍', userId: 'b' }, 1);
    expect(list).toEqual([{ emoji: '👍', count: 2, userIds: ['a', 'b'] }]);
    list = applyReaction(list, { emoji: '👍', userId: 'a' }, -1);
    list = applyReaction(list, { emoji: '👍', userId: 'b' }, -1);
    expect(list).toEqual([]);
    expect(hasMyReaction([{ emoji: '🎉', count: 1, userIds: ['me'] }], '🎉', 'me')).toBe(true);
    expect(reactionErrorText('Chat.Reaction.LimitReached')).toContain('limit');
  });
});

describe('message-text', () => {
  it('enlaces http(s) y www. como enlaces; javascript: queda como texto; sin la puntuación final', () => {
    expect(linkifySegments('See https://irs.gov/forms. and www.x.com, javascript:alert(1)')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://irs.gov/forms', href: 'https://irs.gov/forms' },
      { kind: 'text', text: '. and ' },
      { kind: 'link', text: 'www.x.com', href: 'https://www.x.com/' },
      { kind: 'text', text: ', javascript:alert(1)' },
    ]);
    expect(MESSAGE_MAX_LENGTH).toBe(4000);
  });
});
