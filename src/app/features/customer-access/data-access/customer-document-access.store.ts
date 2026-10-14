import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toUserMessage } from '@core/errors/error-messages';
import {
  AccessCapability,
  AccessPreset,
  AccessResourceType,
  CustomerAccessRuleView,
  PRESETS,
  SetDenyRuleRequest,
  ruleKey,
} from './customer-document-access.model';
import { CustomerDocumentAccessService } from './customer-document-access.service';

/**
 * Reglas deny per-item cargadas por cliente. Un `Map<customerId, rules[]>` sencillo:
 * los admins típicos revisan uno o dos clientes a la vez, así que mantenerlo todo cacheado y
 * replicando el estado del server tras cada mutación evita el flicker típico de "reload tras cada
 * click". Sin optimistic updates — menos superficie de bugs.
 */
@Injectable({ providedIn: 'root' })
export class CustomerDocumentAccessStore {
  private readonly service = inject(CustomerDocumentAccessService);

  private readonly _rulesByCustomer = signal<
    ReadonlyMap<string, readonly CustomerAccessRuleView[]>
  >(new Map());
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Reglas del cliente en memoria (`[]` si no se cargó o no hay). */
  rulesFor(customerId: string): readonly CustomerAccessRuleView[] {
    return this._rulesByCustomer().get(customerId) ?? [];
  }

  /** `true` si ya se trajo la lista alguna vez (aunque sea vacía). */
  hasLoaded(customerId: string): boolean {
    return this._rulesByCustomer().has(customerId);
  }

  /** Lectura reactiva: cambia al mutar el map. */
  readonly rulesSignalFor = (customerId: string) => computed(() => this.rulesFor(customerId));

  async load(customerId: string, force = false): Promise<void> {
    if (!force && this.hasLoaded(customerId)) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      const rules = await firstValueFrom(this.service.list(customerId));
      this.putRules(customerId, rules);
    } catch (err) {
      this._error.set(toUserMessage(err));
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  async setDeny(customerId: string, request: SetDenyRuleRequest): Promise<void> {
    this._error.set(null);
    try {
      const saved = await firstValueFrom(this.service.setDeny(customerId, request));
      const current = this.rulesFor(customerId);
      const key = ruleKey(saved.resourceType, saved.resourceId, saved.capability);
      const next = current.filter(
        (r) => ruleKey(r.resourceType, r.resourceId, r.capability) !== key,
      );
      next.push(saved);
      this.putRules(customerId, next);
    } catch (err) {
      this._error.set(toUserMessage(err));
      throw err;
    }
  }

  async clearDeny(
    customerId: string,
    resourceType: AccessResourceType,
    resourceId: string,
    capability: AccessCapability,
  ): Promise<void> {
    this._error.set(null);
    try {
      await firstValueFrom(
        this.service.clearDeny(customerId, resourceType, resourceId, capability),
      );
      const key = ruleKey(resourceType, resourceId, capability);
      const next = this.rulesFor(customerId).filter(
        (r) => ruleKey(r.resourceType, r.resourceId, r.capability) !== key,
      );
      this.putRules(customerId, next);
    } catch (err) {
      this._error.set(toUserMessage(err));
      throw err;
    }
  }

  /**
   * Aplica un preset global al cliente: calcula el diff vs las reglas `TenantScope` actuales y
   * emite los `setDeny`/`clearDeny` mínimos. No toca overrides per-item (siguen vigentes, deny
   * gana a allow). `'Custom'` no es seleccionable — se calcula del set actual y no debe llegar aquí.
   */
  async applyPreset(
    customerId: string,
    preset: Exclude<AccessPreset, 'Custom'>,
    tenantId: string,
    reason: string | null = null,
  ): Promise<void> {
    const current = new Set<AccessCapability>(
      this.rulesFor(customerId)
        .filter((r) => r.resourceType === 'TenantScope')
        .map((r) => r.capability),
    );
    const target = new Set<AccessCapability>(PRESETS[preset]);
    const toAdd: AccessCapability[] = [];
    const toRemove: AccessCapability[] = [];
    for (const cap of target) {
      if (!current.has(cap)) {
        toAdd.push(cap);
      }
    }
    for (const cap of current) {
      if (!target.has(cap)) {
        toRemove.push(cap);
      }
    }
    for (const cap of toRemove) {
      await this.clearDeny(customerId, 'TenantScope', tenantId, cap);
    }
    for (const cap of toAdd) {
      await this.setDeny(customerId, {
        resourceType: 'TenantScope',
        resourceId: tenantId,
        capability: cap,
        reason,
      });
    }
  }

  private putRules(customerId: string, rules: readonly CustomerAccessRuleView[]): void {
    const copy = new Map(this._rulesByCustomer());
    copy.set(customerId, rules);
    this._rulesByCustomer.set(copy);
  }
}
