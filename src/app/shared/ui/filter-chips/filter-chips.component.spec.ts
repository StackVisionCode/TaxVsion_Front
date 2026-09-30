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
});
