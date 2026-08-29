import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

interface SupportChannelStep {
  icon: string;
  circleClass: string;
  title: string;
  description: string;
}

/**
 * Cabecera del módulo Support: explica cómo se contacta realmente al equipo.
 *
 * NO HAY DATOS DE CONTACTO PORQUE NO EXISTEN: la versión anterior mostraba un
 * teléfono inventado (+1 (800) 555-0142), un email en un dominio que no es el del
 * producto (support@taxvsion.com), chips de disponibilidad ("Online now",
 * "Replies in ~4h") y enlaces `href="#"` que no hacían nada. Ni el backend ni la
 * configuración del front definen una línea telefónica ni un buzón de soporte.
 *
 * Lo que SÍ es real es el flujo de tickets contra Communication
 * (`/communication/support`: abrir, listar y reabrir), así que este bloque solo
 * describe ese flujo — cada paso corresponde a un endpoint que existe.
 */
@Component({
  selector: 'app-support-contact-options',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './support-contact-options.component.html',
})
export class SupportContactOptionsComponent {
  readonly steps: SupportChannelStep[] = [
    {
      // POST /communication/support (formulario "Submit a ticket" más abajo).
      icon: 'create-outline',
      circleClass: 'bg-brand-border text-brand-bold',
      title: 'Open a ticket',
      description:
        'Describe the issue in the form below. The ticket is created in your workspace and routed to our team.',
    },
    {
      // GET /communication/support (lista "My tickets" al pie de la página).
      icon: 'list-outline',
      circleClass: 'bg-indigo-100 text-indigo-600',
      title: 'Follow it up here',
      description:
        'Every ticket you open is listed at the bottom of this page with its current status.',
    },
    {
      // POST /communication/support/:id/reopen (solo desde Resolved/Closed).
      icon: 'refresh-outline',
      circleClass: 'bg-indigo-50 text-orange-500',
      title: 'Reopen if needed',
      description:
        'If a resolved or closed ticket still needs attention, you can reopen it from that list.',
    },
  ];
}
