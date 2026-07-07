import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MailFolderListComponent, MailFolder } from '../../ui/mail-folder-list/mail-folder-list.component';
import { MailListComponent, MailMessage } from '../../ui/mail-list/mail-list.component';
import { MailReadingPaneComponent } from '../../ui/mail-reading-pane/mail-reading-pane.component';
import { MailComposeComponent } from '../../ui/mail-compose/mail-compose.component';

const SEED_FOLDERS: MailFolder[] = [
  { id: 'inbox', label: 'Inbox', icon: 'mail-outline', unreadCount: 0 },
  { id: 'sent', label: 'Sent', icon: 'paper-plane-outline', unreadCount: 0 },
  { id: 'drafts', label: 'Drafts', icon: 'document-text-outline', unreadCount: 0 },
  { id: 'starred', label: 'Starred', icon: 'star-outline', unreadCount: 0 },
  { id: 'archive', label: 'Archive', icon: 'archive-outline', unreadCount: 0 },
  { id: 'trash', label: 'Trash', icon: 'trash-outline', unreadCount: 0 },
];

const SEED_MESSAGES: MailMessage[] = [
  {
    id: 'msg-1',
    folderId: 'inbox',
    senderName: 'Rebecca Chen',
    senderInitials: 'RC',
    senderEmail: 'rebecca.chen@brightpathdesign.com',
    avatarColor: 'bg-indigo-500',
    subject: 'Question about my Schedule C deductions',
    preview: 'Hi, I was reviewing the draft return and had a question about the home office deduction...',
    body: "Hi,\n\nI was reviewing the draft return you sent over and had a question about the home office deduction. Does the square footage calculation include my storage closet, or only the room I use as my dedicated office?\n\nAlso, should I be tracking mileage separately for client visits, or is that already folded into the vehicle expense worksheet you sent last month?\n\nThanks for your patience with all my questions this season!\n\nBest,\nRebecca",
    time: '9:42 AM',
    isRead: false,
    isStarred: true,
  },
  {
    id: 'msg-2',
    folderId: 'inbox',
    senderName: 'DocuSign',
    senderInitials: 'DS',
    senderEmail: 'no-reply@docusign.net',
    avatarColor: 'bg-gray-900',
    subject: 'Completed: Martinez_Engagement_Letter.pdf',
    preview: 'All parties have signed "Martinez_Engagement_Letter.pdf". The completed document is attached.',
    body: 'All parties have signed "Martinez_Engagement_Letter.pdf".\n\nThe completed document, along with the certificate of completion, has been attached to this email for your records. No further action is required.\n\nThis is an automated notification from DocuSign.',
    time: '8:15 AM',
    isRead: true,
    isStarred: false,
  },
  {
    id: 'msg-3',
    folderId: 'inbox',
    senderName: 'Marcus Webb',
    senderInitials: 'MW',
    senderEmail: 'marcus.webb@webbholdings.com',
    avatarColor: 'bg-orange-500',
    subject: 'Invoice #4021 - question on hourly rate',
    preview: 'Quick question on invoice #4021 - it looks like the hourly rate is different from our engagement letter...',
    body: "Hi,\n\nQuick question on invoice #4021 - it looks like the hourly rate for the bookkeeping cleanup is different from what's in our engagement letter ($185 vs $165). Was there an update I missed, or is this a billing error?\n\nHappy to hop on a call if that's easier.\n\nThanks,\nMarcus",
    time: 'Yesterday',
    isRead: true,
    isStarred: false,
  },
  {
    id: 'msg-4',
    folderId: 'inbox',
    senderName: 'Aisha Thompson (Admin)',
    senderInitials: 'AT',
    senderEmail: 'aisha.thompson@ourfirm.com',
    avatarColor: 'bg-[#7C6AE0]',
    subject: 'Reminder: extension deadline Oct 15',
    preview: 'Just a friendly reminder that all extended returns are due by October 15. Please flag anything...',
    body: "Team,\n\nJust a friendly reminder that all extended individual returns are due by October 15. Please flag anything still waiting on client documents so we can follow up this week.\n\nThanks,\nAisha",
    time: 'Yesterday',
    isRead: true,
    isStarred: false,
  },
  {
    id: 'msg-5',
    folderId: 'inbox',
    senderName: 'James Cooper (Preparer)',
    senderInitials: 'JC',
    senderEmail: 'james.cooper@ourfirm.com',
    avatarColor: 'bg-indigo-500',
    subject: "K-1 finally arrived for Ferreira S-corp",
    preview: 'Good news - the K-1 for the Ferreira S-corp came in this morning. Starting the individual return now.',
    body: "Good news - the K-1 for the Ferreira S-corp came in this morning. I'm starting the individual return now and should have a draft ready by tomorrow afternoon.\n\nWill loop you in once it's ready for review.\n\nJames",
    time: '2 days ago',
    isRead: false,
    isStarred: true,
  },
  {
    id: 'msg-6',
    folderId: 'inbox',
    senderName: 'E-Signature Notice',
    senderInitials: 'ES',
    senderEmail: 'esignature@securesign.io',
    avatarColor: 'bg-gray-900',
    subject: 'Signature requested: 2025 Engagement Letter',
    preview: 'Please review and sign your 2025 engagement letter by Friday to avoid delays in filing...',
    body: 'Please review and sign your 2025 engagement letter by Friday to avoid delays in filing your return.\n\nClick the secure link in your client portal to review and apply your signature. This request expires in 7 days.',
    time: '3 days ago',
    isRead: false,
    isStarred: false,
  },
  {
    id: 'msg-7',
    folderId: 'sent',
    senderName: 'Sarah Kim',
    senderInitials: 'SK',
    senderEmail: 'sarah.kim@clientmail.com',
    avatarColor: 'bg-gray-900',
    subject: 'Re: Amended return status',
    preview: 'Just wanted to confirm we filed the 1040-X yesterday afternoon - you should see...',
    body: "Hi Sarah,\n\nJust wanted to confirm we filed the 1040-X yesterday afternoon - you should see the acknowledgment from the IRS within 2-3 weeks. I'll forward it as soon as it comes through.\n\nLet me know if you have any other questions in the meantime.\n\nBest,\nYour tax team",
    time: '10:05 AM',
    isRead: true,
    isStarred: false,
  },
  {
    id: 'msg-8',
    folderId: 'sent',
    senderName: 'Elena Petrova',
    senderInitials: 'EP',
    senderEmail: 'elena.petrova@summitbakery.com',
    avatarColor: 'bg-emerald-500',
    subject: 'Q2 reconciliation attached',
    preview: "Attached is the Q2 reconciliation for Summit Bakery - everything ties out cleanly this quarter.",
    body: "Hi Elena,\n\nAttached is the Q2 reconciliation for Summit Bakery - everything ties out cleanly this quarter. A couple of small notes are in the summary tab regarding the equipment purchase in May.\n\nLet us know if you'd like to walk through it on a call.\n\nBest,\nYour bookkeeping team",
    time: 'Yesterday',
    isRead: true,
    isStarred: true,
  },
  {
    id: 'msg-9',
    folderId: 'drafts',
    senderName: 'David Okafor',
    senderInitials: 'DO',
    senderEmail: 'david.okafor@clientmail.com',
    avatarColor: 'bg-orange-500',
    subject: '(Draft) Follow up on missing W-2',
    preview: 'Hi David, just checking in on the missing W-2 from your previous employer...',
    body: "Hi David,\n\njust checking in on the missing W-2 from your previous employer. Have you had a chance to reach out to their HR department? We'll need it before we can finalize your return.\n\n[draft - finish before sending]",
    time: '11:20 AM',
    isRead: true,
    isStarred: false,
  },
  {
    id: 'msg-10',
    folderId: 'drafts',
    senderName: 'Summit Bakery',
    senderInitials: 'SB',
    senderEmail: 'billing@summitbakery.com',
    avatarColor: 'bg-emerald-500',
    subject: '(Draft) Fee proposal for Summit Bakery',
    preview: 'Thank you for considering us for your 2026 bookkeeping needs. Attached is our proposed fee schedule...',
    body: "Thank you for considering us for your 2026 bookkeeping needs. Attached is our proposed fee schedule based on monthly transaction volume.\n\n[draft - need to attach final PDF before sending]",
    time: 'Jun 28',
    isRead: true,
    isStarred: false,
  },
  {
    id: 'msg-11',
    folderId: 'archive',
    senderName: 'IRS e-Services',
    senderInitials: 'IRS',
    senderEmail: 'no-reply@irs.gov',
    avatarColor: 'bg-gray-900',
    subject: 'Your 2024 return has been accepted',
    preview: 'This confirms that the 2024 individual return for client ID 88213 has been accepted by the IRS.',
    body: 'This confirms that the 2024 individual return for client ID 88213 has been accepted by the IRS.\n\nNo further action is needed at this time. Refund status can be tracked through the standard portal.',
    time: 'Apr 18',
    isRead: true,
    isStarred: true,
  },
  {
    id: 'msg-12',
    folderId: 'trash',
    senderName: 'Promo Refunds Now',
    senderInitials: 'PR',
    senderEmail: 'offers@refundboost.biz',
    avatarColor: 'bg-[#A99BEB]',
    subject: 'RE: Get your tax refund boosted instantly!',
    preview: 'Congratulations! You may be eligible for an instant refund boost - click here to claim...',
    body: 'Congratulations! You may be eligible for an instant refund boost - click here to claim your bonus before this offer expires.',
    time: 'Mar 2',
    isRead: true,
    isStarred: false,
  },
];

/**
 * Página del módulo Mail (estilo "Aether"): bandeja de entrada clásica de 3
 * columnas (carpetas | lista de mensajes | panel de lectura). Reemplaza al
 * cliente de correo completo del CRM original (OAuth2 multi-cuenta,
 * gestor de plantillas, adjuntos reales) por una versión simplificada con
 * datos estáticos en signals: navegación entre carpetas, búsqueda, marcar
 * como leído al abrir, estrella sincronizada entre lista y panel, y un
 * overlay de redacción que simula el envío con un toast transitorio.
 */
@Component({
  selector: 'app-mail-page',
  imports: [CommonModule, MailFolderListComponent, MailListComponent, MailReadingPaneComponent, MailComposeComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-page.component.html',
  styleUrl: './mail-page.component.css',
})
export class MailPageComponent {
  private readonly rawFolders = signal<MailFolder[]>(SEED_FOLDERS);
  readonly messages = signal<MailMessage[]>(SEED_MESSAGES);

  readonly activeFolderId = signal('inbox');
  readonly selectedMessageId = signal<string | null>('msg-1');

  readonly isComposeOpen = signal(false);
  readonly showSentToast = signal(false);

  readonly folders = computed<MailFolder[]>(() =>
    this.rawFolders().map(folder => ({
      ...folder,
      unreadCount: this.messages().filter(message => message.folderId === folder.id && !message.isRead).length,
    })),
  );

  readonly selectedMessage = computed<MailMessage | null>(
    () => this.messages().find(message => message.id === this.selectedMessageId()) ?? null,
  );

  selectFolder(id: string): void {
    this.activeFolderId.set(id);
    this.selectedMessageId.set(null);
  }

  selectMessage(id: string): void {
    // Al elegir un correo se sale del editor y se muestra ese correo.
    this.isComposeOpen.set(false);
    this.selectedMessageId.set(id);
    this.messages.update(list => list.map(message => (message.id === id ? { ...message, isRead: true } : message)));
  }

  toggleStar(id: string): void {
    this.messages.update(list =>
      list.map(message => (message.id === id ? { ...message, isStarred: !message.isStarred } : message)),
    );
  }

  openCompose(): void {
    this.isComposeOpen.set(true);
  }

  closeCompose(): void {
    this.isComposeOpen.set(false);
  }

  handleSent(): void {
    this.isComposeOpen.set(false);
    this.showSentToast.set(true);
    setTimeout(() => this.showSentToast.set(false), 2500);
  }
}
