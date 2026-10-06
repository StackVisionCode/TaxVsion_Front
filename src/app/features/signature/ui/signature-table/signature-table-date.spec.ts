import { TestBed } from '@angular/core/testing';
import { AccessStore } from '@core/access/access.store';
import { SignatureTableComponent } from './signature-table.component';

/**
 * La tabla recibía la fecha sin 'Z' del backend y la parseaba como hora local, lo que corría la
 * fecha de un día cuando el instante estaba cerca de medianoche UTC. Este spec fija el caso.
 */
describe('SignatureTableComponent · formatDate', () => {
  let component: SignatureTableComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SignatureTableComponent],
      providers: [{ provide: AccessStore, useValue: { permissions: () => new Set<string>() } }],
    });
    const fixture = TestBed.createComponent(SignatureTableComponent);
    component = fixture.componentInstance;
  });

  it('devuelve guión para null', () => {
    expect(component.formatDate(null)).toBe('—');
  });

  it('un instante sin Z se interpreta como UTC, no como hora local', () => {
    // Comparamos contra lo que da parseUtcDate directo: si el componente lo parsea mal, el día o la
    // hora salen distintos a los del instante real UTC.
    const expected = new Date('2026-03-15T02:00:00Z').toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(component.formatDate('2026-03-15T02:00:00')).toBe(expected);
  });

  it('muestra hora además de fecha', () => {
    const result = component.formatDate('2026-06-10T14:00:00Z');
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});
