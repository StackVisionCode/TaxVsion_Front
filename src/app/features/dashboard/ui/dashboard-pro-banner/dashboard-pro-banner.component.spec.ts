import { TestBed } from '@angular/core/testing';
import { computed } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { DashboardProBannerComponent } from './dashboard-pro-banner.component';

/**
 * B3 — el banner ofrece contratar el plan Professional. Se muestra solo a quien puede contratarlo:
 * mandar a un empleado a `/plans` para que descubra ahí que no puede comprar nada es una promesa
 * que la aplicación no puede cumplir.
 */
describe('DashboardProBannerComponent', () => {
  function create(canManageBilling: boolean) {
    TestBed.configureTestingModule({
      imports: [DashboardProBannerComponent],
      providers: [
        provideRouter([]),
        { provide: AccessStore, useValue: { canManageBilling: computed(() => canManageBilling) } },
      ],
    });
    const fixture = TestBed.createComponent(DashboardProBannerComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('se muestra a quien gestiona la facturación', () => {
    const fixture = create(true);

    expect(fixture.nativeElement.textContent).toContain('Professional');
    expect(fixture.nativeElement.querySelector('a[href="/plans"]')).toBeTruthy();
  });

  it('no se muestra a quien no puede contratar', () => {
    const fixture = create(false);

    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });
});
