import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { featureById, moduleLabel } from '@core/access/features';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';

export type AccessNoticeKind = 'forbidden' | 'not-available' | 'error';

/**
 * B4 — la pantalla a la que llega una URL que el usuario no puede abrir. Son tres avisos distintos
 * y no uno solo porque la salida es distinta en cada caso:
 *
 * - `not-available` (plan): la oficina no contrató el módulo. Se arregla contratándolo, y solo
 *   quien gestiona la facturación puede hacerlo; a los demás pedirles un permiso no los acerca.
 * - `forbidden` (permiso): la oficina sí lo tiene, a esta persona no se lo dieron. Se arregla
 *   hablando con el administrador de la oficina.
 * - `error`: no es una decisión de acceso, es que el servicio no contestó. Se reintenta.
 *
 * Un aviso único ("no tenés acceso") mandaría a la mitad de la gente a pedir lo que no soluciona
 * nada. Comparten componente para que las tres se vean igual, no para decir lo mismo.
 */
@Component({
  selector: 'app-access-notice-page',
  imports: [CommonModule, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './access-notice-page.component.html',
})
export class AccessNoticePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly access = inject(AccessStore);
  protected readonly handoff = inject(AccountHandoffStore);

  readonly kind = computed<AccessNoticeKind>(() => {
    const declared = this.route.snapshot.data['kind'];
    return declared === 'not-available' || declared === 'error' ? declared : 'forbidden';
  });

  /** El nombre que ve el usuario, del registro. Si no vino feature, se habla en genérico. */
  readonly featureLabel = computed(() => {
    const id = this.route.snapshot.queryParamMap.get('feature');
    return (id && featureById(id)?.label) ?? null;
  });

  /** La URL que se intentó abrir, para poder reintentarla cuando el problema era el servicio. */
  readonly attemptedUrl = computed(() => this.route.snapshot.queryParamMap.get('from'));

  readonly canManageBilling = this.access.canManageBilling;

  /**
   * B7 — el módulo que falta, para poder nombrarlo. Viene de dos sitios: del guard, que manda la
   * feature y de ahí se saca su módulo, o del interceptor ante un `Authz.ModuleUnavailable`, que
   * manda el módulo directo y no tiene feature.
   */
  readonly missingModule = computed(() => {
    const explicit = this.route.snapshot.queryParamMap.get('module');
    if (explicit) {
      return explicit;
    }
    const id = this.route.snapshot.queryParamMap.get('feature');
    return (id && featureById(id)?.module) ?? null;
  });

  readonly icon = computed(() => {
    switch (this.kind()) {
      case 'not-available':
        return 'sparkles-outline';
      case 'error':
        return 'cloud-offline-outline';
      default:
        return 'lock-closed-outline';
    }
  });

  readonly title = computed(() => {
    const feature = this.featureLabel();
    switch (this.kind()) {
      case 'not-available':
        return feature ? `${feature} isn't part of your plan` : 'Not part of your plan';
      case 'error':
        return "We couldn't load this section";
      default:
        return feature ? `You don't have access to ${feature}` : "You don't have access";
    }
  });

  readonly message = computed(() => {
    switch (this.kind()) {
      case 'not-available': {
        // Nombrar el módulo cuando se sabe: "the comms module" es accionable, "this section" no.
        const module = this.missingModule();
        const what = module ? moduleLabel(module) : 'this section';
        return this.canManageBilling()
          ? `Your plan does not include ${what}. Adding it enables the section for everyone in your office.`
          : `Your plan does not include ${what}. Ask whoever manages billing in your office to add it.`;
      }
      case 'error':
        return 'The service did not respond. This is usually temporary — try again in a moment.';
      default:
        return 'This section is restricted. Ask your office administrator to give you access.';
    }
  });

  /**
   * Los planes y los add-ons se contratan en el Account del sitio público, no acá (el CRM dejó de
   * tener pantalla de suscripción). Se sale con esta misma sesión, igual que desde el menú de
   * usuario. Solo se le ofrece a quien puede pagar: al resto no se le muestran precios ni add-ons,
   * que es lo que pedía la fase — no exponerle datos comerciales a quien no corresponde.
   */
  manageSubscription(): void {
    this.handoff.open();
  }

  retry(): void {
    const url = this.attemptedUrl();
    if (url) {
      void this.router.navigateByUrl(url);
      return;
    }
    this.location.back();
  }

  goBack(): void {
    this.location.back();
  }
}
