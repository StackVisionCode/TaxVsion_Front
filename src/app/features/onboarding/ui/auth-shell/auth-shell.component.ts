import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Tarjeta flotante de las pantallas públicas (login/registro): fondo indigo con
 * dos orbes difuminados, panel de marca en gradiente a la izquierda y el
 * contenido proyectado a la derecha.
 *
 * Extraído literal del `register-page` original para que las 5 pantallas del
 * flujo de compra compartan exactamente el mismo lenguaje visual en vez de
 * duplicar la misma cadena de clases Tailwind cinco veces.
 *
 * `wide` ensancha la tarjeta: lo usa el selector de planes, que necesita más
 * aire que un formulario de una columna.
 */
@Component({
  selector: 'app-auth-shell',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './auth-shell.component.html',
  styleUrl: './auth-shell.component.css',
})
export class AuthShellComponent {
  @Input() panelEyebrow = 'Join TaxPro Office';
  @Input() panelHeading = 'Create your account and run your tax firm from one place';
  @Input() wide = false;
}
