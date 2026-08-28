import {
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from '../navbar/navbar.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { ChatSocketService } from '@features/chat/data-access/chat-socket.service';
import { SessionRevocationService } from '@core/auth/session-revocation.service';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { AuthService } from '@core/auth/auth.service';

/**
 * Shell de la app autenticada: navbar arriba, sidebar a la izquierda,
 * contenido de la ruta activa a la derecha. Visual únicamente — no hay
 * guard de autenticación real todavía.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, NavbarComponent, SidebarComponent],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css',
})
export class AppShellComponent implements OnInit {
  private readonly socket = inject(ChatSocketService);
  private readonly sessionRevocation = inject(SessionRevocationService);
  private readonly branding = inject(TenantBrandingService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isSidebarExpanded = signal(true);

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
    this.socket.sessionRevoked$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((revokedSid) => {
        if (this.sessionRevocation.handleRevoked(revokedSid)) {
          this.socket.disconnect();
        }
      });
  }

  onSidebarStateChange(expanded: boolean): void {
    this.isSidebarExpanded.set(expanded);
  }

  /** Tope combinado de elementos animados por página (evita entradas larguísimas). */
  private static readonly MAX_STAGGER_ITEMS = 10;
  private static readonly STAGGER_STEP_MS = 60;
  /** Cantidad de "sabores" de animación disponibles (ver app-shell.component.css). */
  private static readonly FLAVOR_COUNT = 6;

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
  onRouteActivate(retriesLeft = 5): void {
    const wrapper = this.routeContentRef?.nativeElement;
    // <router-outlet> es un tag real en el DOM (no un comentario-ancla): el
    // componente que activa se inserta como HERMANO siguiente, no como hijo
    // del outlet. `wrapper.firstElementChild` sería el outlet vacío mismo.
    const outlet = wrapper?.querySelector('router-outlet');
    const pageRoot = outlet?.nextElementSibling as HTMLElement | null;

    // `(activate)` dispara apenas se instancia el componente de la página,
    // que puede ser antes de que: (a) el propio @ViewChild de este shell
    // esté resuelto (primerísima activación tras arrancar la app), o (b) el
    // template de la página recién creada ya haya poblado sus hijos. Ambos
    // casos se resuelven solos un tick después — reintentar unas pocas
    // veces cubre ambos sin necesitar lógica distinta para cada uno.
    if (!pageRoot || pageRoot.children.length === 0) {
      if (retriesLeft > 0) {
        setTimeout(() => this.onRouteActivate(retriesLeft - 1));
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
