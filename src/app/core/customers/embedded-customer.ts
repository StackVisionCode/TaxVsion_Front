import { Directive, Injectable, Input, Signal, inject, signal } from '@angular/core';

/** Cliente al que se fija un módulo cuando se monta dentro del perfil del cliente. */
export interface EmbeddedCustomer {
  id: string;
  name: string;
}

/**
 * Contexto "módulo embebido en el perfil de UN cliente".
 *
 * Patrón (ver `features/documents/components/client-documents-workspace`):
 * - Cada módulo expone un wrapper `Client<Modulo>WorkspaceComponent` que extiende
 *   `EmbeddedCustomerHost` y declara `providers: [EmbeddedCustomerContext, <SuStore>]`. Así el
 *   módulo recibe una instancia NUEVA de su store (no pisa el estado de su página global).
 * - La página del módulo (y su store) leen `injectEmbeddedCustomer()`: `null` en la página normal,
 *   el cliente cuando están embebidas. Con eso ocultan la navegación global, filtran por cliente y
 *   preseleccionan el cliente en los flujos de "crear".
 * - El perfil (`features/clients`) monta el wrapper con `@defer` (chunk aparte). Es la excepción
 *   documentada a "una feature no importa de otra".
 */
@Injectable()
export class EmbeddedCustomerContext {
  readonly customer = signal<EmbeddedCustomer | null>(null);
}

const NOT_EMBEDDED: Signal<EmbeddedCustomer | null> = signal(null).asReadonly();

/** Cliente embebido del contexto más cercano, o `null` si el módulo corre en su página normal. */
export function injectEmbeddedCustomer(): Signal<EmbeddedCustomer | null> {
  return inject(EmbeddedCustomerContext, { optional: true })?.customer.asReadonly() ?? NOT_EMBEDDED;
}

/**
 * Base de los wrappers `Client<Modulo>WorkspaceComponent`: recibe `clientId`/`clientName` del
 * perfil y los publica en el `EmbeddedCustomerContext` que el wrapper provee.
 */
@Directive()
export abstract class EmbeddedCustomerHost {
  private readonly context = inject(EmbeddedCustomerContext);
  private id = '';
  private name = '';

  @Input({ required: true }) set clientId(value: string) {
    this.id = value;
    this.publish();
  }

  @Input() set clientName(value: string) {
    this.name = value;
    this.publish();
  }

  private publish(): void {
    this.context.customer.set(this.id ? { id: this.id, name: this.name || 'Client' } : null);
  }
}
