import { TestBed } from '@angular/core/testing';
import { StatCardsComponent, StatCardItem } from './stat-cards.component';

describe('StatCardsComponent', () => {
  function create(items: StatCardItem[], loading = false) {
    TestBed.configureTestingModule({ imports: [StatCardsComponent] });
    const fixture = TestBed.createComponent(StatCardsComponent);
    fixture.componentRef.setInput('items', items);
    fixture.componentRef.setInput('loading', loading);
    fixture.detectChanges();
    const cards = Array.from(fixture.nativeElement.querySelectorAll('.rounded-\\[1\\.5rem\\]')) as HTMLElement[];
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

  it('tono navy pinta el tile sólido con texto blanco', () => {
    const { cards } = create([{ label: 'Available', value: '$10.00', tone: 'navy', hint: 'Ready' }]);
    expect(cards[0].classList.contains('bg-brand-bold')).toBe(true);
    expect(cards[0].querySelector('.text-3xl')!.classList.contains('text-white')).toBe(true);
    expect(cards[0].querySelector('.text-xs')!.classList.contains('text-white/75')).toBe(true);
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
  it('delta pinta flecha y texto con el color del sentimiento', () => {
    const { cards } = create([
      { label: 'Sent', value: 12, delta: { label: '+20% vs prior', direction: 'up', sentiment: 'positive' } },
      { label: 'Overdue', value: 3, delta: { label: '+1', direction: 'up', sentiment: 'negative' } },
    ]);
    const good = cards[0].querySelector('.bg-emerald-50')!;
    expect(good.textContent).toContain('+20% vs prior');
    expect((good.querySelector('ion-icon') as unknown as { name: string }).name).toBe('trending-up-outline');
    expect(cards[1].querySelector('.bg-red-50')).toBeTruthy();
  });

  it('sin delta o cargando no pinta la pastilla', () => {
    const { cards } = create(
      [{ label: 'Sent', value: 12, delta: { label: '+1', direction: 'up', sentiment: 'positive' } }],
      true,
    );
    expect(cards[0].querySelector('.bg-emerald-50')).toBeNull();
  });

  it('info agrega un botón con nombre accesible y el texto para lectores de pantalla', () => {
    const { cards } = create([{ label: 'Completion rate', value: '40%', info: 'Completed ÷ sent.' }]);
    const button = cards[0].querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('About Completion rate');
    expect(cards[0].querySelector('.sr-only')!.textContent).toContain('Completed ÷ sent.');
  });
});
