import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { ActivatedRoute, Router, UrlTree, convertToParamMap, provideRouter } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';
import { AccessNoticeKind, AccessNoticePageComponent } from './access-notice-page.component';

/**
 * B4 — el aviso tiene que decir la VERDAD y la salida correcta. Un "no tenés acceso" único
 * mandaría a la mitad de la gente a pedirle un permiso al administrador cuando lo que falta es que
 * la oficina contrate el módulo, y a la otra mitad a mirar precios cuando ya lo tienen contratado.
 */
describe('AccessNoticePageComponent', () => {
  let handoffOpened: number;

  function create(
    kind: AccessNoticeKind,
    options: { feature?: string; from?: string; module?: string; canManageBilling?: boolean } = {},
  ) {
    handoffOpened = 0;
    const queryParams: Record<string, string> = {};
    if (options.feature) queryParams['feature'] = options.feature;
    if (options.from) queryParams['from'] = options.from;
    if (options.module) queryParams['module'] = options.module;

    TestBed.configureTestingModule({
      imports: [AccessNoticePageComponent],
      providers: [
        provideRouter([]),
        { provide: AccessStore, useValue: { canManageBilling: computed(() => options.canManageBilling ?? false) } },
        {
          provide: AccountHandoffStore,
          useValue: { opening: signal(false), error: signal<string | null>(null), open: () => handoffOpened++ },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { kind }, queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    });
    const fixture = TestBed.createComponent(AccessNoticePageComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  // ---------- Permiso: el administrador de la oficina ----------

  it('nombra la sección y manda con el administrador', () => {
    const fixture = create('forbidden', { feature: 'campaigns' });
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain("You don't have access to Campaigns");
    expect(text).toContain('office administrator');
    expect(text).not.toContain('plan');
  });

  it('sin feature en la URL habla en genérico, no muestra un id crudo', () => {
    const fixture = create('forbidden');

    expect(fixture.nativeElement.textContent).toContain("You don't have access");
    expect(fixture.componentInstance.featureLabel()).toBeNull();
  });

  it('un feature desconocido no rompe la pantalla', () => {
    const fixture = create('forbidden', { feature: 'no-existe' });

    expect(fixture.componentInstance.featureLabel()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain("You don't have access");
  });

  // ---------- Plan: la pantalla comercial ----------

  it('a quien gestiona la facturación le ofrece los planes', () => {
    const fixture = create('not-available', { feature: 'chat', canManageBilling: true });
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain("Chat isn't part of your plan");
    expect(fixture.nativeElement.querySelector('a[href="/plans"]')).toBeTruthy();
  });

  it('a quien no puede contratar le dice a quién pedírselo, sin ofrecerle precios', () => {
    const fixture = create('not-available', { feature: 'chat' });
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Ask whoever manages billing');
    expect(fixture.nativeElement.querySelector('a[href="/plans"]')).toBeNull();
  });

  // ---------- Servicio caído: no es una decisión de acceso ----------

  it('el error ofrece reintentar y no habla de permisos', () => {
    const fixture = create('error', { from: '/clients' });
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain("We couldn't load this section");
    expect(text).not.toContain('administrator');
    expect(text).toContain('Try again');
  });

  it('reintentar vuelve a la URL que se había intentado', () => {
    const fixture = create('error', { from: '/clients' });
    const navigated: string[] = [];
    const router = TestBed.inject(Router);
    router.navigateByUrl = (url: string | UrlTree) => {
      navigated.push(url.toString());
      return Promise.resolve(true);
    };

    fixture.componentInstance.retry();

    expect(navigated).toEqual(['/clients']);
  });

  // ---------- Un tipo desconocido no deja la pantalla en blanco ----------

  it('un kind que no existe cae del lado conservador', () => {
    const fixture = create('vaya' as AccessNoticeKind);

    expect(fixture.componentInstance.kind()).toBe('forbidden');
  });

  // ---------- B7: nombrar el módulo y llevar a donde se contrata ----------

  it('nombra el módulo que falta, no "esta sección"', () => {
    // "the comms module" es accionable; "this section" obliga a adivinar qué contratar.
    const fixture = create('not-available', { feature: 'chat', canManageBilling: true });

    // El nombre que el usuario reconoce, no el código interno `comms`.
    expect(fixture.nativeElement.textContent).toContain('Client communication');
    expect(fixture.nativeElement.textContent).not.toContain('comms module');
  });

  it('acepta el módulo directo, sin feature (el 403 del interceptor no tiene una)', () => {
    const fixture = create('not-available', { module: 'signatures' });

    expect(fixture.componentInstance.missingModule()).toBe('signatures');
    expect(fixture.nativeElement.textContent).toContain('E-signature');
  });

  it('sin módulo ni feature habla en genérico', () => {
    const fixture = create('not-available');

    expect(fixture.nativeElement.textContent).toContain('this section');
  });

  it('a quien puede contratar le ofrece la gestión de la suscripción', () => {
    // Los planes y add-ons se contratan en el Account; el CRM ya no tiene esa pantalla.
    const fixture = create('not-available', { feature: 'chat', canManageBilling: true });

    fixture.componentInstance.manageSubscription();

    expect(fixture.nativeElement.textContent).toContain('Manage subscription');
    expect(handoffOpened).toBe(1);
  });

  it('a un empleado no se le muestra NADA comercial', () => {
    // El criterio de la fase: no exponerle datos comerciales a quien no corresponde.
    const fixture = create('not-available', { feature: 'chat' });
    const text = fixture.nativeElement.textContent as string;

    expect(fixture.nativeElement.querySelector('a[href="/plans"]')).toBeNull();
    expect(text).not.toContain('Manage subscription');
    expect(text).toContain('Ask whoever manages billing');
  });
});
