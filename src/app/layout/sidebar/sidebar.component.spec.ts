import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { FEATURES, featureById } from '@core/access/features';
import { ChatStore } from '@features/chat/data-access/chat.store';
import { PacedPreloadStrategy } from '@core/performance/paced-preload.strategy';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { SidebarComponent } from './sidebar.component';

/**
 * B3 — el menú sale del registro. Los casos son los del Anexo C: el 2 (plan sin Client
 * communication) y el 4 (empleado sin el permission de meetings con el módulo activo), que hoy
 * terminaban en un 403 después de hacer clic.
 *
 * El `AccessStore` se stubea a propósito: acá se prueba que el menú PREGUNTA bien, no que el store
 * CONTESTE bien — eso ya lo cubre `access.store.spec.ts` con sus propios fixtures.
 */
describe('SidebarComponent', () => {
  function create(options: { permissions?: string[]; modules?: string[] | null } = {}) {
    const permissions = new Set(options.permissions ?? []);
    const modules = options.modules === undefined ? null : options.modules;

    const canUseId = (id: string | undefined): boolean => {
      if (!id) return true;
      const feature = featureById(id);
      if (!feature) return true;
      if (feature.module !== null && modules !== null && !modules.includes(feature.module)) {
        return false;
      }
      return feature.anyOf.length === 0 || feature.anyOf.some(code => permissions.has(code));
    };

    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        { provide: AccessStore, useValue: { canUseId, canManageBilling: signal(false) } },
        { provide: ChatStore, useValue: { totalUnread: signal(0) } },
        { provide: PacedPreloadStrategy, useValue: { prefetchPath: () => undefined } },
        {
          provide: TenantBrandingService,
          useValue: { logoUrl: signal<string | null>(null), faviconUrl: signal<string | null>(null) },
        },
      ],
    });

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    return fixture;
  }

  function labels(fixture: ReturnType<typeof create>): string[] {
    return fixture.componentInstance.visibleItems().map(item => item.label);
  }

  afterEach(() => TestBed.resetTestingModule());

  // ---------- Caso 4 del Anexo C ----------

  it('un empleado sin permission de campaigns no ve Campaigns', () => {
    const fixture = create({ permissions: ['customers.view'], modules: ['customers', 'campaigns'] });

    expect(labels(fixture)).not.toContain('Campaigns');
    expect(labels(fixture)).toContain('Clients');
  });

  it('con el módulo activo pero sin el permission, Meetings tampoco aparece', () => {
    // Éste es el caso 4 tal cual: el módulo está contratado, el backend contesta 403 y hasta hoy
    // el CRM mostraba la entrada igual.
    const fixture = create({ permissions: ['communication.chat.start'], modules: ['comms'] });

    expect(labels(fixture)).toContain('Chat');
    expect(labels(fixture)).not.toContain('Meetings');
  });

  // ---------- Caso 2 del Anexo C ----------

  it('un plan sin Client communication deja el menú sin Chat ni Meetings', () => {
    // Standard (`Starter`) no incluye `comms`. El permission lo tiene igual: el que falta es el
    // módulo, y por eso no alcanza con mirar permissions.
    const fixture = create({
      permissions: ['communication.chat.start', 'communication.meeting.create', 'customers.view'],
      modules: ['customers'],
    });

    expect(labels(fixture)).not.toContain('Chat');
    expect(labels(fixture)).not.toContain('Meetings');
    expect(labels(fixture)).toContain('Clients');
  });

  it('con el módulo y el permission, el administrador sí los ve', () => {
    const fixture = create({
      // Desde el split comms/meetings hacen falta los DOS módulos: Chat cuelga de `comms` y
      // Meetings de `meetings`. Antes bastaba `comms` para ambos.
      permissions: ['communication.chat.start', 'communication.meeting.create'],
      modules: ['comms', 'meetings'],
    });

    expect(labels(fixture)).toContain('Chat');
    expect(labels(fixture)).toContain('Meetings');
  });

  // ---------- Lo transversal se queda ----------

  it('sin permissions y sin módulos solo quedan las entradas transversales', () => {
    // AI entra acá porque el asistente todavía no tiene backend ni permission propio; el día que
    // lo tenga, este test se cae y avisa que hay que declararlo en el registro.
    const fixture = create({ permissions: [], modules: [] });

    expect(labels(fixture)).toEqual(['Dashboard', 'AI', 'Settings']);
  });

  it('sin bootstrap no se esconde nada por plan', () => {
    // `modules: null` = "todavía no sé qué contrató la oficina". Esconder ahí sería más estricto
    // que el backend, cuyo gate de módulo está en log-only.
    const fixture = create({ permissions: ['sms.read'] });

    expect(labels(fixture)).toContain('SMS');
    expect(labels(fixture)).toContain('Workflow');
  });

  // ---------- El pill deslizante ----------

  it('el resaltado se mide sobre el item VISIBLE, no sobre la lista completa', async () => {
    // El bug: el índice salía de `menuItems()` y los botones del DOM son los visibles. Con SMS
    // oculto, el pill de Chat se posaba sobre Meetings.
    const fixture = create({
      permissions: ['communication.chat.start', 'communication.meeting.create'],
      modules: ['comms'],
    });
    const component = fixture.componentInstance;

    const visible = component.visibleItems();
    const chatIndex = visible.findIndex(item => item.route === '/chat');
    expect(chatIndex).toBeGreaterThan(0);

    // jsdom devuelve rectángulos en cero: se les da uno distinto a cada fila para poder distinguir
    // cuál midió.
    const buttons = fixture.nativeElement.querySelectorAll('button[type="button"]') as NodeListOf<HTMLElement>;
    expect(buttons.length).toBe(visible.length);
    buttons.forEach((button, index) => {
      button.getBoundingClientRect = () =>
        ({ top: 100 * (index + 1), left: 0, width: 200, height: 40 }) as DOMRect;
    });

    component.menuItems.update(items =>
      items.map(item => ({ ...item, isActive: item.route === '/chat' })),
    );
    fixture.detectChanges();
    (component as unknown as { syncIndicator(): void }).syncIndicator();

    expect(component.indicatorReady()).toBe(true);
    expect(component.indicatorTop()).toBe(100 * (chatIndex + 1));
  });

  // ---------- El menú y el registro hablan el mismo idioma ----------

  it('la etiqueta del menú es la del registro', () => {
    // B4 le puso `label` al registro para poder escribir "Campaigns isn't part of your plan". Si el
    // menú dijera otra cosa, el usuario vería dos nombres para la misma sección.
    const fixture = create();

    for (const item of fixture.componentInstance.menuItems()) {
      const feature = featureById(item.featureId!);
      expect(item.label, `"${item.label}" no coincide con el registro`).toBe(feature!.label);
    }
  });

  it('toda entrada declara una feature que existe en el registro', () => {
    const ids = new Set(FEATURES.map(feature => feature.id));
    const fixture = create();

    for (const item of fixture.componentInstance.menuItems()) {
      expect(item.featureId, `la entrada "${item.label}" no declara featureId`).toBeTruthy();
      expect(ids.has(item.featureId!), `featureId desconocido: ${item.featureId}`).toBe(true);
    }
  });
});
