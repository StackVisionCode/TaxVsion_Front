import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { CustomerSearchParams, CustomerSummary, PagedResult } from '@core/customers/customer-summary.model';
import { CustomerPickerComponent } from './customer-picker.component';

function customer(id: string, name: string, status: CustomerSummary['status'] = 'Active'): CustomerSummary {
  return {
    id,
    kind: 'Individual',
    status,
    displayName: name,
    primaryEmail: `${id}@example.com`,
    primaryPhone: null,
    createdAtUtc: '2026-01-01T00:00:00Z',
  };
}

class FakeStore {
  readonly recent = signal<CustomerSummary[]>([]);
  readonly searches: CustomerSearchParams[] = [];
  readonly added: CustomerSummary[] = [];
  items = [customer('1', 'Jane Roe'), customer('2', 'Old Co', 'Archived')];

  search(params: CustomerSearchParams): Observable<PagedResult<CustomerSummary>> {
    this.searches.push(params);
    return of({
      items: this.items,
      page: 1,
      size: 20,
      totalCount: this.items.length,
      totalPages: 1,
      hasMore: false,
      hasPrevious: false,
    });
  }

  byId(ids: readonly string[]): Observable<Map<string, CustomerSummary>> {
    return of(new Map(ids.map(id => [id, customer(id, `Resolved ${id}`)])));
  }

  addRecent(c: CustomerSummary): void {
    this.added.push(c);
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('CustomerPickerComponent', () => {
  function setup(inputs: Record<string, unknown> = {}) {
    const store = new FakeStore();
    TestBed.configureTestingModule({
      imports: [CustomerPickerComponent],
      providers: [{ provide: CustomerDirectoryStore, useValue: store }],
    });
    const fixture = TestBed.createComponent(CustomerPickerComponent);
    fixture.componentRef.setInput('debounceMs', 0);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    const emitted: (CustomerSummary | null)[] = [];
    fixture.componentInstance.selectedChange.subscribe(v => emitted.push(v));
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, store, el, emitted };
  }

  it('busca con status NotArchived, oculta archivados, elige y muestra el chip', async () => {
    const { fixture, store, el, emitted } = setup();
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = 'ja';
    input.dispatchEvent(new Event('input'));
    await tick();
    fixture.detectChanges();

    expect(store.searches[0]).toEqual({ term: 'ja', status: 'NotArchived', page: 1, size: 20 });
    const options = Array.from(el.querySelectorAll('[role="option"]')) as HTMLButtonElement[];
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain('Jane Roe');
    expect(options[0].textContent).toContain('1@example.com');

    options[0].click();
    fixture.detectChanges();
    expect(emitted.map(c => c?.id)).toEqual(['1']);
    expect(store.added.map(c => c.id)).toEqual(['1']);
    expect(el.querySelector('input')).toBeNull();
    expect(el.textContent).toContain('Jane Roe');

    (el.querySelector('[aria-label="Change client"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(emitted[1]).toBeNull();
    expect(el.querySelector('input')).toBeTruthy();
  });

  it('resuelve selectedId con el store', () => {
    const { el } = setup({ selectedId: '42' });
    expect(el.textContent).toContain('Resolved 42');
  });

  it('variant inline no muestra chip tras elegir', async () => {
    const { fixture, el, emitted } = setup({ variant: 'inline' });
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = 'j';
    input.dispatchEvent(new Event('input'));
    await tick();
    fixture.detectChanges();
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(emitted.length).toBe(1);
    expect(el.querySelector('input')).toBeTruthy();
  });
});
