import { TestBed } from '@angular/core/testing';
import { FilterChipsComponent } from './filter-chips.component';

describe('FilterChipsComponent', () => {
  function create(inputs: Record<string, unknown>) {
    TestBed.configureTestingModule({ imports: [FilterChipsComponent] });
    const fixture = TestBed.createComponent(FilterChipsComponent<string>);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe(v => emitted.push(v));
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    return { buttons, emitted };
  }

  const options = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active', count: 3 },
  ];

  it('marca el activo y emite al cambiar', () => {
    const { buttons, emitted } = create({ options, value: 'all' });
    expect(buttons[0].classList.contains('bg-brand-bold')).toBe(true);
    expect(buttons[1].classList.contains('border-gray-200')).toBe(true);
    expect(buttons[0].classList.contains('py-2')).toBe(true);
    expect(buttons[1].querySelector('.opacity-70')?.textContent).toBe('3');
    buttons[0].click();
    buttons[1].click();
    expect(emitted).toEqual(['active']);
  });

  it('size sm usa py-1.5', () => {
    const { buttons } = create({ options, value: 'all', size: 'sm' });
    expect(buttons[0].classList.contains('py-1.5')).toBe(true);
  });

  it('collapseAfter: con más opciones que el tope, una sola píldora (dropdown) con la etiqueta activa', () => {
    const many = ['all', 'a', 'b', 'c'].map(id => ({ id, label: id.toUpperCase() }));
    const { buttons } = create({ options: many, value: 'b', collapseAfter: 2 });
    const trigger = buttons.find(b => b.hasAttribute('menutrigger'))!;
    expect(trigger.textContent).toContain('B');
    expect(trigger.classList.contains('bg-brand-bold')).toBe(true);
    expect(buttons.some(b => b.hasAttribute('aria-pressed'))).toBe(false);
  });

  it('por defecto colapsa con más de 5 opciones; con All activo la píldora va inactiva', () => {
    const many = ['All', 'a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id }));
    const { buttons } = create({ options: many, value: 'All' });
    const trigger = buttons.find(b => b.hasAttribute('menutrigger'))!;
    expect(trigger.classList.contains('border-gray-200')).toBe(true);
  });

  it('collapseAfter null: siempre chips', () => {
    const many = ['all', 'a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id }));
    const { buttons } = create({ options: many, value: 'all', collapseAfter: null });
    expect(buttons.length).toBe(6);
  });

  it('collapseAfter: sin pasar el tope sigue pintando chips', () => {
    const { buttons } = create({ options, value: 'all', collapseAfter: 5 });
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
  });
});
