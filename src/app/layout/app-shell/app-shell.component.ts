import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  ViewChild,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';
import { filter, map, of, switchMap, timer } from 'rxjs';
import { NavbarComponent } from '../navbar/navbar.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { ToastHostComponent } from '@shared/ui/toast/toast-host.component';
import { CallOverlayComponent } from '@core/communication/call-overlay/call-overlay.component';
import { ActiveCallService } from '@core/communication/active-call.service';
import { ChatSocketService } from '@features/chat/data-access/chat-socket.service';
import { ChatStore } from '@features/chat/data-access/chat.store';
import { NotificationsStore } from '@features/notifications/data-access/notifications.store';
import { SessionRevocationService } from '@core/auth/session-revocation.service';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { AuthService } from '@core/auth/auth.service';
import { prefersReducedMotion } from '@shared/utils/reduced-motion.util';

/**
 * Shell de la app autenticada: navbar arriba, sidebar a la izquierda,
 * contenido de la ruta activa a la derecha. Visual únicamente — no hay
 * guard de autenticación real todavía.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, NavbarComponent, SidebarComponent, ToastHostComponent, CallOverlayComponent],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css',
})
export class AppShellComponent implements OnInit, OnDestroy {
  private readonly socket = inject(ChatSocketService);
  private readonly activeCall = inject(ActiveCallService);
  private readonly chatStore = inject(ChatStore);
  private readonly notificationsStore = inject(NotificationsStore);
  private readonly sessionRevocation = inject(SessionRevocationService);
  private readonly branding = inject(TenantBrandingService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  protected readonly isSidebarExpanded = signal(true);

  /**
   * Barra de progreso de navegación. Entre el clic en el sidebar y el pintado de la página
   * no había NINGUNA señal: la app parecía colgada mientras bajaba el chunk de la sección.
   *
   * Solo se enciende si la navegación pasa de UMBRAL ms — con el preloading la mayoría
   * termina antes, y una barra que parpadea se lee peor que ninguna barra.
   */
  protected readonly navigating = toSignal(
    this.router.events.pipe(
      filter(
        event =>
          event instanceof NavigationStart ||
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError,
      ),
      switchMap(event =>
        event instanceof NavigationStart
          ? timer(AppShellComponent.NAV_PROGRESS_DELAY_MS).pipe(map(() => true))
          : of(false),
      ),
    ),
    { initialValue: false },
  );

  @ViewChild('routeContent') private routeContentRef?: ElementRef<HTMLElement>;

  ngOnInit(): void {
    // Marca del tenant ya autenticado: pinta tema/logo/favicon por su tenantId (endpoint
    // autenticado, funciona en dev sin subdominio). Aditivo y con fallback total.
    const tenantId = this.auth.currentUser()?.tenant.id;
    if (tenantId) {
      this.branding.applyForTenant(tenantId, 'Crm');
    }

    // Sesión única: abre el socket de tiempo real al entrar al shell y escucha `session.revoked`
    // (logout forzado si el usuario abre otra sesión en otro dispositivo). connect() es idempotente,
    // así que el chat reusa esta misma conexión cuando se abre.
    this.socket.connect();
    // Llamadas 1:1: escuchar entrantes en cualquier página (el overlay global vive en el shell).
    this.activeCall.bindGlobalListeners();
    // Notificaciones reales en vivo (campana del navbar) + badge de no-leídos del chat (sidebar).
    this.notificationsStore.startRealtime();
    this.chatStore.primeForBadge();
    this.socket.sessionRevoked$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((revokedSid) => {
        if (this.sessionRevocation.handleRevoked(revokedSid)) {
          this.socket.disconnect();
        }
      });

    // Al volver de otra pestaña, asegurar el tiempo real. Si el server nos echó mientras
    // estábamos ocultos (token vencido), el socket quedó suelto y esto lo reconstruye con
    // el token vigente; si sigue vivo, connect() es un no-op. Sin esto la campana, el chat
    // y las llamadas entrantes quedaban mudos hasta recargar.
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** Reengancha el socket al volver la pestaña al foco (ver ngOnInit). */
  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this.socket.connect();
    }
  };

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    // El shell posee el ciclo de vida del socket compartido de Communication: se destruye al
    // salir de /app (logout / redirección), así que acá se cierra para no dejarlo colgado.
    this.socket.disconnect();
  }

  onSidebarStateChange(expanded: boolean): void {
    this.isSidebarExpanded.set(expanded);
  }

  /**
   * Tope combinado de elementos animados por página y separación entre ellos.
   *
   * Antes eran 10 × 60 ms, que con los 320-380 ms de duración del keyframe dejaban el
   * último bloque invisible hasta ~940 ms DESPUÉS de que la página ya tenía sus datos
   * (`animation-fill-mode: both` mantiene el `opacity: 0` durante el delay). Eso es lo
   * que se percibía como "la pantalla se dibuja de a poquito". Con 6 × 35 ms el último
   * bloque entra a ~435 ms: sigue leyéndose como una entrada escalonada, pero deja de
   * competir con la sensación de velocidad.
   */
  private static readonly MAX_STAGGER_ITEMS = 6;
  private static readonly STAGGER_STEP_MS = 35;
  /** Cantidad de "sabores" de animación disponibles (ver app-shell.component.css). */
  private static readonly FLAVOR_COUNT = 6;
  /** Umbral antes de mostrar la barra de progreso (por debajo, parpadearía). */
  private static readonly NAV_PROGRESS_DELAY_MS = 120;

  /**
   * Se dispara cada vez que router-outlet activa un componente nuevo. En vez
   * de animar el wrapper de la página como un solo bloque, entra un nivel y
   * escalona la entrada de los hijos directos de la raíz de esa página (fila
   * de stats, tarjeta principal, panel, columna, etc.), cada uno con un
   * delay creciente y un "sabor" de animación cíclico distinto — cada
   * pieza de nivel superior de CUALQUIER página se siente distinta, sin
   * tocar el archivo de esa página.
   *
   * Cuando un hijo se detecta como fila de stats (heurística: tiene la
   * clase `grid` y ≥3 hijos propios — patrón usado en ~8 páginas), no se
   * anima el contenedor: se baja un nivel y se escalonan sus tarjetas
   * individuales en su lugar, imitando el tratamiento por-widget del
   * Dashboard. El resto de las páginas simplemente no cumple el guard y se
   * queda con el stagger de nivel superior.
   *
   * Cada hijo es DOM recién creado por el router, así que no hace falta el
   * truco de reflow que sí necesitaría un elemento persistente.
   */
  onRouteActivate(): void {
    // Con reduced-motion no se toca el DOM siquiera: ni clases ni estilos inline, así que
    // la página aparece completa de una vez (que es justo lo que se pidió).
    if (prefersReducedMotion()) {
      return;
    }
    // `(activate)` dispara al instanciar el componente, antes de que su template haya
    // poblado los hijos. afterNextRender espera al render REAL en vez de adivinar con
    // setTimeout encadenados; queda un único reintento como red de seguridad para las
    // páginas que pintan su raíz en un segundo tick.
    afterNextRender(() => this.applyStaggerToPage(1), { injector: this.injector });
  }

  private applyStaggerToPage(retriesLeft: number): void {
    const wrapper = this.routeContentRef?.nativeElement;
    // <router-outlet> es un tag real en el DOM (no un comentario-ancla): el
    // componente que activa se inserta como HERMANO siguiente, no como hijo
    // del outlet. `wrapper.firstElementChild` sería el outlet vacío mismo.
    const outlet = wrapper?.querySelector('router-outlet');
    const pageRoot = outlet?.nextElementSibling as HTMLElement | null;

    // Tras el afterNextRender de onRouteActivate esto ya suele estar poblado. Queda un
    // único reintento para los dos casos que pueden llegar un tick tarde: (a) el @ViewChild
    // de este shell en la primerísima activación tras arrancar la app, y (b) una página
    // cuya raíz se puebla en un segundo tick.
    if (!pageRoot || pageRoot.children.length === 0) {
      if (retriesLeft > 0) {
        setTimeout(() => this.applyStaggerToPage(retriesLeft - 1));
      }
      return;
    }

    const topLevelChildren = Array.from(pageRoot.children) as HTMLElement[];
    let animatedCount = 0;

    for (const child of topLevelChildren) {
      if (animatedCount >= AppShellComponent.MAX_STAGGER_ITEMS) break;

      if (this.looksLikeStatsRow(child)) {
        const cards = Array.from(child.children) as HTMLElement[];
        for (const card of cards) {
          if (animatedCount >= AppShellComponent.MAX_STAGGER_ITEMS) break;
          this.applyStagger(card, animatedCount);
          animatedCount++;
        }
        continue;
      }

      this.applyStagger(child, animatedCount);
      animatedCount++;
    }
  }

  /** Heurística: fila de stats = contenedor grid con 3 o más tarjetas propias. */
  private looksLikeStatsRow(element: HTMLElement): boolean {
    return element.classList.contains('grid') && element.children.length >= 3;
  }

  private applyStagger(element: HTMLElement, index: number): void {
    element.classList.add('stagger-enter');
    element.setAttribute('data-stagger-flavor', String(index % AppShellComponent.FLAVOR_COUNT));
    element.style.animationDelay = `${index * AppShellComponent.STAGGER_STEP_MS}ms`;
  }
}
