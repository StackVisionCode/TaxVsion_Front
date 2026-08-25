import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TokenService } from '@core/auth/token.service';

/**
 * Página 404. Antes de existir, cualquier URL desconocida dejaba la pantalla EN BLANCO
 * (el router no encontraba ruta y no había comodín), que es el peor resultado posible:
 * el usuario no sabe si la app se rompió o si el enlace estaba mal.
 *
 * El destino del botón principal depende de si hay sesión: con sesión, al panel; sin
 * ella, al inicio de sesión. Mandar a alguien sin sesión al panel solo produce un rebote
 * a través del guard.
 */
@Component({
  selector: 'app-not-found-page',
  imports: [CommonModule, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './not-found-page.component.html',
})
export class NotFoundPageComponent {
  private readonly tokenService = inject(TokenService);
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  /** La URL que se intentó abrir; ayuda a ver de un vistazo si el enlace venía cortado. */
  readonly attemptedUrl = this.router.url;

  readonly isLoggedIn = computed(() => this.tokenService.isAuthenticated());
  readonly homeLink = computed(() => (this.isLoggedIn() ? '/dashboard' : '/login'));
  readonly homeLabel = computed(() => (this.isLoggedIn() ? 'Go to dashboard' : 'Go to sign in'));

  goBack(): void {
    this.location.back();
  }
}
