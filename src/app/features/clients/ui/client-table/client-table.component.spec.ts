import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StaffDirectoryStore } from '@core/staff/staff-directory.store';
import { ClientItem, ClientTableComponent } from './client-table.component';

/** Encabezados ordenables: dicen el orden vigente (aria-sort) y piden el cambio al padre. */
describe('ClientTableComponent · encabezados ordenables', () => {
  const CLIENT: ClientItem = {
    id: 'c1',
    type: 'individual',
    displayName: 'Ana Torres',
    email: 'ana@example.com',
    phone: '',
    address: '',
    isActive: true,
    createdAt: '2026-07-15',
  };

  function render() {
    TestBed.configureTestingModule({
      imports: [ClientTableComponent],
      providers: [
        provideRouter([]),
        { provide: StaffDirectoryStore, useValue: { ensureLoaded: () => {}, resolve: () => null } },
      ],
    });
    const fixture = TestBed.createComponent(ClientTableComponent);
    fixture.componentInstance.clients = [CLIENT];
    fixture.componentInstance.sort = { field: 'Created', dir: 'Desc' };
    fixture.detectChanges();
    return { fixture, page: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('solo la columna que ordena lleva aria-sort, con su sentido', () => {
    const { page } = render();
    const headers = Array.from(page.querySelectorAll('th'));
    const created = headers.find(th => th.textContent?.includes('Created'));
    const name = headers.find(th => th.textContent?.includes('Name'));

    expect(created?.getAttribute('aria-sort')).toBe('descending');
    expect(name?.hasAttribute('aria-sort')).toBe(false);
  });

  it('el clic en un encabezado pide ordenar por esa columna', () => {
    const { fixture, page } = render();
    const requested: string[] = [];
    fixture.componentInstance.sortRequested.subscribe(field => requested.push(field));

    (page.querySelector('button[aria-label="Sort by Name"]') as HTMLButtonElement).click();

    expect(requested).toEqual(['Name']);
  });
});
