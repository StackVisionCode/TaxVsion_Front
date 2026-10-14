import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, inject, signal } from '@angular/core';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { LoginTransitionService } from './login-transition.service';

/**
 * Módulos que "llegan" al infinito mientras carga el shell (orden del sidebar). Todos están
 * registrados inline en `src/main.ts`; uno nuevo hay que agregarlo ahí o <ion-icon> rompe el render.
 */
export const LOGIN_TRANSITION_ICONS: readonly string[] = [
  'people-outline',
  'document-text-outline',
  'create-outline',
  'receipt-outline',
  'mail-outline',
  'videocam-outline',
  'chatbubbles-outline',
  'megaphone-outline',
];

/** Posición de partida (rem) de cada chip: repartidos a ambos lados, a distintas alturas. */
const CHIP_START: readonly [number, number][] = [
  [-13, -3.2],
  [13, -2.4],
  [-11, 2.6],
  [12, 3],
  [-15, 0],
  [15, 0.4],
  [-9, -4],
  [10, -4],
];

/**
 * Overlay de la transición login → dashboard. Host montado UNA vez en `app.html` (como los modales
 * de sesión): la raíz es el único lugar que sobrevive al cambio de ruta. Solo lee
 * `LoginTransitionService`; la escena es decorativa (`aria-hidden`) y el caption es lo que se anuncia.
 *
 * Escena: sobre fondo crema, el infinito de Taxoffix se dibuja con la luz azul del loader; los
 * módulos llegan flotando desde los lados y se funden en él, con la marca del tenant al centro y una
 * barra de progreso indeterminada. Solo se animan opacity/transform (ver el .css).
 */
@Component({
  selector: 'app-login-transition',
  templateUrl: './login-transition.component.html',
  styleUrl: './login-transition.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class LoginTransitionComponent {
  protected readonly transition = inject(LoginTransitionService);
  private readonly branding = inject(TenantBrandingService);

  /**
   * Logo ya aplicado por la página de login (`applyForSurface`); null → asterisco de marca. Se lee
   * directo y no vía BrandLogoComponent, que vuelve a pedir el branding en cada constructor.
   */
  protected readonly logoUrl = this.branding.logoUrl;
  protected readonly logoFailed = signal(false);

  protected readonly chips = LOGIN_TRANSITION_ICONS.map((icon, i) => ({
    icon,
    x: `${CHIP_START[i][0]}rem`,
    y: `${CHIP_START[i][1]}rem`,
    delay: `${(i * 0.45).toFixed(2)}s`,
  }));

  /** Lemniscata de `InfinityLoaderComponent`: dos lazos unidos en el centro (32,16). */
  protected readonly path =
    'M32 16 C24 4 14 4 10 4 C5 4 2 9 2 16 C2 23 5 28 10 28 C14 28 24 28 32 16 C40 4 50 4 54 4 C59 4 62 9 62 16 C62 23 59 28 54 28 C50 28 40 28 32 16 Z';
}
