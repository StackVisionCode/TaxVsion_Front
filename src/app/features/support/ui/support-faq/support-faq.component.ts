import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface SupportFaq {
  id: string;
  question: string;
  answer: string;
}

const FAQS: SupportFaq[] = [
  {
    id: 'faq-upload',
    question: 'How do I upload client documents?',
    answer:
      'Open the Documents module, pick the client and drop files anywhere in their folder — or use the Upload button. PDF, images and Office files up to 25 MB each are supported, and every upload is versioned automatically.',
  },
  {
    id: 'faq-esign',
    question: 'How do e-signatures work?',
    answer:
      'Send any PDF for signature from the client\'s file browser. The client receives a secure link, signs from any device, and the executed copy with its audit trail is stored back in their folder automatically.',
  },
  {
    id: 'faq-invite',
    question: 'How do I invite a client to the portal?',
    answer:
      'From the client\'s profile choose "Invite to portal". They get an email with a one-time setup link where they create a password. Once inside they can upload documents, sign forms and message your team.',
  },
  {
    id: 'faq-status',
    question: 'How do I track the status of a tax return?',
    answer:
      'Every return moves through stages — Intake, In preparation, In review, Filed and Accepted. The dashboard shows totals per stage, and each client card shows the current stage with the date it last changed.',
  },
  {
    id: 'faq-reminders',
    question: 'Can I send automatic reminders to clients?',
    answer:
      'Yes. Reminders for missing documents, unsigned forms and unpaid invoices can be scheduled per client or globally. Each reminder is logged in the client\'s activity feed so your team never double-sends.',
  },
  {
    id: 'faq-billing',
    question: 'How do I update my billing details or plan?',
    answer:
      'Go to Settings → Billing to change your card, download invoices or switch plans. Upgrades apply immediately and downgrades take effect at the end of the current billing cycle — no data is ever deleted.',
  },
];

/**
 * Acordeón de preguntas frecuentes del módulo Support (estilo "Aether"):
 * tarjetas internas con header suave; al hacer clic se expande la respuesta y
 * el chevron rota con transición CSS. Interacción 100% local vía signal.
 */
@Component({
  selector: 'app-support-faq',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './support-faq.component.html',
})
export class SupportFaqComponent {
  readonly faqs = FAQS;

  /** Id de la pregunta abierta; null = todas cerradas. */
  readonly openFaqId = signal<string | null>(null);

  toggle(id: string): void {
    this.openFaqId.update(current => (current === id ? null : id));
  }
}
