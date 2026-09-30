import {
  Directive,
  Input,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';

/**
 * Directiva estructural para mostrar un elemento solo si el usuario puede usarlo. Reactiva: si
 * cambia la sesión o el plan, la vista se agrega o se retira sola.
 *
 * Tres formas, de menos a más precisa:
 *   <button *appHasPermission="'customers.manage'">New client</button>
 *   <button *appHasPermission="['customers.manage','customers.view']">…</button>   // con uno alcanza
 *   <button *appHasPermission="{ module: 'documents', anyOf: ['cloudstorage.file.delete'] }">…</button>
 *
 * La tercera es la que hace falta cuando la acción además depende del plan de la oficina: con las
 * dos primeras, un permiso que el usuario tiene pero cuyo módulo no está contratado mostraba el
 * botón igual. B6 la agregó para no tener que elegir entre esta directiva y un `@if` a mano.
 *
 * Es solo UX: el backend sigue siendo la autoridad. Para reglas compuestas que además exigen actor
 * administrativo (p. ej. `customers.manage` + TA) se usan las señales de capacidad de la feature
 * con `@if` — el actor type no es un permiso y no entra acá.
 */
export type PermissionRequirement = string | readonly string[] | AccessRequirement;

@Directive({ selector: '[appHasPermission]', standalone: true })
export class HasPermissionDirective {
  private readonly tpl = inject(TemplateRef<unknown>);
  private readonly vcr = inject(ViewContainerRef);
  private readonly access = inject(AccessStore);

  private readonly required = signal<PermissionRequirement>([]);
  private visible = false;

  @Input({ required: true })
  set appHasPermission(value: PermissionRequirement) {
    this.required.set(value);
  }

  constructor() {
    effect(() => this.sync(this.allowed(this.required())));
  }

  private allowed(requirement: PermissionRequirement): boolean {
    if (typeof requirement === 'string') {
      return this.access.can(requirement);
    }
    if (Array.isArray(requirement)) {
      return this.access.canAny(requirement);
    }
    return this.access.canUse(requirement as AccessRequirement);
  }

  private sync(allowed: boolean): void {
    if (allowed && !this.visible) {
      this.vcr.createEmbeddedView(this.tpl);
      this.visible = true;
    } else if (!allowed && this.visible) {
      this.vcr.clear();
      this.visible = false;
    }
  }
}
