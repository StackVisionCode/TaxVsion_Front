import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ChatMessageSearchComponent, ChatSearchResult } from './chat-message-search.component';

const result = (id: string, isVoiceNote = false): ChatSearchResult => ({
  id,
  senderName: 'Ana',
  text: `match ${id}`,
  time: '10:00 AM',
  dateGroup: 'Today',
  isVoiceNote,
});

describe('ChatMessageSearchComponent (F7)', () => {
  function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(ChatMessageSearchComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('lista los resultados (marca las notas de voz) y emite el elegido', () => {
    const { fixture, el } = render({ query: 'match', results: [result('1'), result('2', true)] });
    const picked: string[] = [];
    fixture.componentInstance.resultSelected.subscribe(id => picked.push(id));
    const rows = el.querySelectorAll('[data-role="chat-search-result"]');
    expect(rows).toHaveLength(2);
    expect(rows[1].querySelector('ion-icon[name="mic-outline"]')).not.toBeNull();
    (rows[1] as HTMLButtonElement).click();
    expect(picked).toEqual(['2']);
  });

  it('resaltado de un resultado no cargado con su aviso; sin resultados → "No messages found."', () => {
    const highlighted = render({ query: 'match', results: [result('1')], highlightedId: '1' }).el;
    expect(highlighted.querySelector('[data-role="chat-search-result"]')?.classList).toContain('bg-amber-50');
    expect(highlighted.querySelector('[data-role="chat-search-not-loaded"]')).not.toBeNull();

    const empty = render({ query: 'zz', results: [] }).el;
    expect(empty.querySelector('[data-role="chat-search-empty"]')?.textContent).toContain('No messages found.');
    // Con 1 carácter no se busca: tampoco se dice "no encontrado".
    expect(render({ query: 'z', results: [] }).el.querySelector('[data-role="chat-search-empty"]')).toBeNull();
  });
});
