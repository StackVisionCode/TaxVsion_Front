import { TestBed } from '@angular/core/testing';
import { StatCardsComponent, StatCardItem } from './stat-cards.component';

describe('StatCardsComponent', () => {
  function create(items: StatCardItem[], loading = false) {
    TestBed.configureTestingModule({ imports: [StatCardsComponent] });
    const fixture = TestBed.createComponent(StatCardsComponent);
    fixture.componentRef.setInput('items', items);
    fixture.componentRef.setInput('loading', loading);
    fixture.detectChanges();
    const cards = Array.from(fixture.nativeElement.querySelectorAll('.rounded-\\[24px\\]')) as HTMLElement[];
    return { fixture, cards };
  }

  it('pinta etiqueta y cifra con la rotación de tonos por defecto', () => {
    const { cards } = create([
      { label: 'Total', value: 12 },
      { label: 'Active', value: '$4.00' },
      { label: 'Low', value: 0 },
      { label: 'Cats', value: 3, tone: 'white', hint: 'across all' },
    ]);
    expect(cards.length).toBe(4);
    expect(cards[0].classList.contains('bg-orange-100')).toBe(true);
    expect(cards[1].classList.contains('bg-sand-100')).toBe(true);
    expect(cards[2].classList.contains('bg-sage-100')).toBe(true);
    expect(cards[3].classList.contains('bg-white')).toBe(true);
    expect(cards[1].textContent).toContain('$4.00');
    expect(cards[2].querySelector('.text-3xl')!.textContent?.trim()).toBe('0');
    expect(cards[3].textContent).toContain('across all');
  });

  it('loading muestra "—"', () => {
    const { cards } = create([{ label: 'Total', value: 5 }], true);
    expect(cards[0].querySelector('.text-3xl')!.textContent?.trim()).toBe('—');
  });

  it('valor null muestra "—"', () => {
    const { cards } = create([{ label: 'X', value: null }]);
    expect(cards[0].querySelector('.text-3xl')!.textContent?.trim()).toBe('—');
  });

  it('countUp usa la directiva (inline-block)', () => {
    const { cards } = create([{ label: 'Total', value: 7, countUp: true }]);
    expect(cards[0].querySelector('.inline-block.text-3xl')).toBeTruthy();
  });
});
