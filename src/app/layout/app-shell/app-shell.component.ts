import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from '../navbar/navbar.component';
import { SidebarComponent } from '../sidebar/sidebar.component';

/**
 * Shell de la app autenticada: navbar arriba, sidebar a la izquierda,
 * contenido de la ruta activa a la derecha. Visual únicamente — no hay
 * guard de autenticación real todavía.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, NavbarComponent, SidebarComponent],
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  protected readonly isSidebarExpanded = signal(true);

  onSidebarStateChange(expanded: boolean): void {
    this.isSidebarExpanded.set(expanded);
  }
}
