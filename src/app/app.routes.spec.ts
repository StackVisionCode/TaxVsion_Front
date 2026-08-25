import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { routes } from './app.routes';
import { NotFoundPageComponent } from './shared/ui/not-found-page/not-found-page.component';

/**
 * El enrutado de las pantallas PÚBLICAS es contrato con el backend: son las URLs que
 * viaja en los correos (registro, invitación, confirmación de email, firma, pago). Si
 * una deja de resolver, el enlace muere en manos del usuario y no hay forma de saberlo
 * sin abrir el correo — por eso se comprueban aquí.
 */
describe('app.routes', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => localStorage.clear());

  it('una URL desconocida cae en la página 404, no en blanco', async () => {
    const component = await harness.navigateByUrl('/esta-ruta-no-existe');
    expect(component).toBeInstanceOf(NotFoundPageComponent);
  });

  it('también con varios segmentos', async () => {
    const component = await harness.navigateByUrl('/algo/que/no/existe');
    expect(component).toBeInstanceOf(NotFoundPageComponent);
  });

  /**
   * Cada una llega de un correo del backend. Se comprueba que resuelven y que NO caen
   * en el 404; el componente concreto se carga de forma diferida y no hace falta afirmarlo.
   */
  const publicLinks = [
    '/login',
    '/register?token=abc',
    '/accept-invitation?token=abc',
    '/confirm-email?token=abc',
    '/reset-password?token=abc',
    '/forgot-password',
    '/find-office',
    '/sign/abc',
    // El backend compone este con `Signature:PublicBaseUrl` + /<token>.
    '/signature/public/abc',
    '/pay/abc',
  ];

  for (const url of publicLinks) {
    it(`resuelve la ruta pública ${url}`, async () => {
      const component = await harness.navigateByUrl(url);
      expect(component).not.toBeInstanceOf(NotFoundPageComponent);
    });
  }

  it('la raíz lleva al login cuando no hay params del callback OAuth', async () => {
    const router = TestBed.inject(Router);
    await harness.navigateByUrl('/');
    expect(router.url).toBe('/login');
  });
});
