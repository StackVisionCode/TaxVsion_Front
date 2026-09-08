import {
  Directive,
  Input,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';

/**
 * Directiva estructural para mostrar un elemento solo si el usuario tiene el permiso
 * (o al menos uno de una lista). Reactiva: si cambia la sesión, la vista se agrega o
 * retira sola.
 *
 * Uso:
 *   <button *appHasPermission="'customers.manage'">New client</button>
 *   <button *appHasPermission="['customers.manage','customers.view']">…</button>  // hasAny
 *
 * Es solo UX: el backend sigue siendo la autoridad. Para reglas compuestas (permiso +
 * actor admin) usa las señales de capacidad de la feature con `@if`, no esta directiva.
 */
@Directive({ selector: '[appHasPermission]', standalone: true })
export class HasPermissionDirective {
  private readonly tpl = inject(TemplateRef<unknown>);
  private readonly vcr = inject(ViewContainerRef);
  private readonly perms = inject(PermissionService);

  private readonly required = signal<string | readonly string[]>([]);
  private visible = false;

  @Input({ required: true })
  set appHasPermission(value: string | readonly string[]) {
    this.required.set(value);
  }

  constructor() {
    effect(() => {
      const req = this.required();
      const allowed = Array.isArray(req) ? this.perms.hasAny(req) : this.perms.has(req as string);
      this.sync(allowed);
    });
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
