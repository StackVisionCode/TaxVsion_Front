import { TestBed } from '@angular/core/testing';
import { PaginationComponent } from './pagination.component';

describe('PaginationComponent', () => {
  function create(inputs: Record<string, unknown>) {
    TestBed.configureTestingModule({ imports: [PaginationComponent] });
    const fixture = TestBed.createComponent(PaginationComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    const emitted: number[] = [];
    fixture.componentInstance.pageChange.subscribe(p => emitted.push(p));
    const el = fixture.nativeElement as HTMLElement;
    const next = () => el.querySelector('[aria-label="Next page"]') as HTMLButtonElement | null;
    const prev = () => el.querySelector('[aria-label="Previous page"]') as HTMLButtonElement | null;
    return { el, emitted, next, prev };
  }

  it('numbered (default) sin cambios: rango + "Page N of M"', () => {
    const { el, emitted, next } = create({ currentPage: 1, totalItems: 20, pageSize: 8 });
    expect(el.textContent).toContain('Showing');
    expect(el.textContent).toContain('1–8');
    expect(el.textContent).toContain('Page 1 of 3');
    next()!.click();
    expect(emitted).toEqual([2]);
  });

  it('numbered se oculta si todo cabe', () => {
    const { next } = create({ currentPage: 1, totalItems: 5, pageSize: 8 });
    expect(next()).toBeNull();
  });

  it('cursor: "Page N" sin total, Next según hasNext', () => {
    const { el, emitted, next, prev } = create({ mode: 'cursor', currentPage: 2, hasNext: true });
    expect(el.textContent).toContain('Page 2');
    expect(el.textContent).not.toContain('of');
    expect(el.textContent).not.toContain('Showing');
    next()!.click();
    prev()!.click();
    expect(emitted).toEqual([3, 1]);
  });

  it('cursor sin siguiente deshabilita Next; en página 1 sin siguiente se oculta', () => {
    const a = create({ mode: 'cursor', currentPage: 3, hasNext: false });
    expect(a.next()!.disabled).toBe(true);
  });

  it('cursor en página 1 sin siguiente no pinta nada', () => {
    const b = create({ mode: 'cursor', currentPage: 1, hasNext: false });
    expect(b.next()).toBeNull();
  });
});
