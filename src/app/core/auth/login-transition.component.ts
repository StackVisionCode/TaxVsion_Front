import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, inject, signal } from '@angular/core';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { LoginTransitionService } from './login-transition.service';

/**
 * Módulos que "pasan" frente a la marca mientras carga el shell (orden del sidebar). Todos están
 * registrados inline en `src/main.ts`; uno nuevo hay que agregarlo ahí o <ion-icon> rompe el render.
 */
export const LOGIN_TRANSITION_ICONS: readonly string[] = [
  'people-outline',
  'document-text-outline',
  'create-outline',
  'receipt-outline',
  'mail-outline',
  'checkmark-done-outline',
  'videocam-outline',
  'chatbubbles-outline',
  'chatbox-ellipses-outline',
  'megaphone-outline',
  'cube-outline',
  'pricetags-outline',
  'git-network-outline',
  'sparkles-outline',
];

/**
 * Overlay de la transición login → dashboard. Host montado UNA vez en `app.html` (como los modales
 * de sesión): la raíz es el único lugar que sobrevive al cambio de ruta. Solo lee
 * `LoginTransitionService`; la escena es puramente decorativa (`aria-hidden` en la cinta) y el
 * caption es lo que se anuncia.
 *
 * Escena: marca del tenant en el centro, una cinta de iconos de módulos en bucle continuo, nítida en
 * el centro y cada vez más desenfocada hacia los bordes (capas de backdrop-filter con máscaras), y un
 * "enfoque" inicial donde toda la cinta arranca borrosa. Ver el .css para la mecánica.
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

  /** Dos copias: la pista mide el doble y se desplaza -50 %, así vuelve al mismo pixel sin costura. */
  protected readonly conveyor = [...LOGIN_TRANSITION_ICONS, ...LOGIN_TRANSITION_ICONS];
}
