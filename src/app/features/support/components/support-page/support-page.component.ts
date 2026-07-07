import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupportContactOptionsComponent } from '../../ui/support-contact-options/support-contact-options.component';
import { SupportFaqComponent } from '../../ui/support-faq/support-faq.component';
import { SupportTicketFormComponent } from '../../ui/support-ticket-form/support-ticket-form.component';

/**
 * Página del módulo Support (estilo "Aether"). Reemplaza al centro de soporte
 * por chat del CRM original con tres bloques visuales: opciones de contacto,
 * acordeón de preguntas frecuentes y mini-formulario de tickets. Todo local:
 * datos estáticos en signals, sin servicios ni HTTP.
 */
@Component({
  selector: 'app-support-page',
  imports: [CommonModule, SupportContactOptionsComponent, SupportFaqComponent, SupportTicketFormComponent],
  templateUrl: './support-page.component.html',
})
export class SupportPageComponent {}
