import { TestBed } from '@angular/core/testing';
import { SearchInputComponent } from './search-input.component';

describe('SearchInputComponent', () => {
  function create(inputs: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({ imports: [SearchInputComponent] });
    const fixture = TestBed.createComponent(SearchInputComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe(v => emitted.push(v));
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input') as HTMLInputElement;
    const type = (v: string) => {
      input.value = v;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    return { fixture, el, input, emitted, type };
  }

  it('refleja value y emite en cada tecla por defecto', () => {
    const { input, emitted, type } = create({ value: 'abc', placeholder: 'Search products' });
    expect(input.value).toBe('abc');
    expect(input.placeholder).toBe('Search products');
    expect(input.classList.contains('w-48')).toBe(true);
    type('abcd');
    expect(emitted).toEqual(['abcd']);
  });

  it('botón limpiar emite vacío', () => {
    const { el, emitted, type, fixture } = create();
    expect(el.querySelector('[aria-label="Clear search"]')).toBeNull();
    type('x');
    (el.querySelector('[aria-label="Clear search"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['x', '']);
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('');
  });

  it('con debounce emite solo el último valor', async () => {
    const { emitted, type } = create({ debounceMs: 20 });
    type('a');
    type('ab');
    expect(emitted).toEqual([]);
    await new Promise(r => setTimeout(r, 40));
    expect(emitted).toEqual(['ab']);
  });
});
