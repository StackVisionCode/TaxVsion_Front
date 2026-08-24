import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterOutlet, provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      // El shell raíz solo monta el outlet: sin router configurado, RouterOutlet no arranca.
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  /**
   * El template raíz es únicamente `<router-outlet />` (el layout real vive en
   * AppShellComponent, dentro de las rutas), así que lo único que puede afirmarse
   * acá es que el outlet queda montado: si desapareciera, ninguna ruta pintaría.
   */
  it('should mount the router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.debugElement.query(By.directive(RouterOutlet))).toBeTruthy();
  });
});
