import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

interface ContactOption {
  icon: string;
  circleClass: string;
  title: string;
  description: string;
  chipLabel: string;
  chipClass: string;
  actionLabel: string;
}

/**
 * Fila de opciones de contacto del módulo Support (estilo "Aether"): tres
 * tarjetas internas (chat en vivo, email, teléfono) con círculos de icono en
 * pasteles y chips outline de disponibilidad. Visual-only: sin acciones reales.
 */
@Component({
  selector: 'app-support-contact-options',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './support-contact-options.component.html',
})
export class SupportContactOptionsComponent {
  readonly options: ContactOption[] = [
    {
      icon: 'chatbubbles-outline',
      circleClass: 'bg-[#D6CEF4] text-[#7C6AE0]',
      title: 'Live chat',
      description: 'Chat with a support agent in real time about anything in your workspace.',
      chipLabel: 'Online now',
      chipClass: 'border-green-200 text-green-600',
      actionLabel: 'Start a chat',
    },
    {
      icon: 'mail-outline',
      circleClass: 'bg-[#CBD9F2] text-indigo-600',
      title: 'Email us',
      description: 'Send the details to support@taxvsion.com and we will get back to you.',
      chipLabel: 'Replies in ~4h',
      chipClass: 'border-indigo-200 text-indigo-600',
      actionLabel: 'Write an email',
    },
    {
      icon: 'call-outline',
      circleClass: 'bg-[#F2E3C9] text-orange-500',
      title: 'Call us',
      description: 'Talk to our team directly at +1 (800) 555-0142 for urgent issues.',
      chipLabel: 'Mon–Fri, 9am–6pm ET',
      chipClass: 'border-orange-200 text-orange-600',
      actionLabel: 'View phone hours',
    },
  ];
}
