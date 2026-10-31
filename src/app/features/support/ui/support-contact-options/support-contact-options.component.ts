import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

interface SupportChannelStep {
  icon: string;
  circleClass: string;
  title: string;
  description: string;
}

/**
 * Panel de Support sin ticket elegido: explica cómo se contacta realmente al equipo.
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
      // POST /communication/support (botón "New ticket").
      icon: 'create-outline',
      circleClass: 'bg-brand-border text-brand-bold',
      title: 'Open a ticket',
      description: 'Use New ticket to describe the issue. It goes straight to our support team.',
    },
    {
      // GET /communication/support (columna de la izquierda, con sus no leídos).
      icon: 'chatbubbles-outline',
      circleClass: 'bg-indigo-100 text-indigo-600',
      title: 'Chat with us',
      description: 'Replies show up in the ticket. A blue counter marks the tickets with new messages.',
    },
    {
      // POST /communication/support/:id/reopen (solo desde Resolved/Closed).
      icon: 'refresh-outline',
      circleClass: 'bg-indigo-50 text-orange-500',
      title: 'Reopen if needed',
      description: 'If a resolved or closed ticket still needs attention, open it and choose Reopen.',
    },
  ];
}
