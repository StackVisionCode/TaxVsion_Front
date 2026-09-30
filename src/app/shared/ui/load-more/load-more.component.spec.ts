import { TestBed } from '@angular/core/testing';
import { LoadMoreComponent } from './load-more.component';

describe('LoadMoreComponent', () => {
  function create(inputs: Record<string, unknown>) {
    TestBed.configureTestingModule({ imports: [LoadMoreComponent] });
    const fixture = TestBed.createComponent(LoadMoreComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    let loads = 0;
    fixture.componentInstance.load.subscribe(() => loads++);
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement | null;
    return { button, loads: () => loads };
  }

  it('sin hasMore no pinta nada', () => {
    expect(create({ hasMore: false }).button).toBeNull();
  });

  it('emite load', () => {
    const { button, loads } = create({ hasMore: true });
    expect(button!.textContent?.trim()).toBe('Load more');
    button!.click();
    expect(loads()).toBe(1);
  });

  it('cargando: deshabilitado y "Loading…"', () => {
    const { button } = create({ hasMore: true, loading: true });
    expect(button!.disabled).toBe(true);
    expect(button!.textContent?.trim()).toBe('Loading…');
  });
});
