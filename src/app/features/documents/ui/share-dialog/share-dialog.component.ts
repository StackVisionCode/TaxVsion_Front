import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import {
  CreateShareLinkRequest,
  FileResponse,
  SharePermission,
  ShareVisibility,
} from '../../data-access/documents.model';

interface AccessOption {
  id: ShareVisibility;
  title: string;
  description: string;
}

/**
 * Diálogo de compartir un archivo. Access = quién puede abrirlo (miembros del tenant, el
 * cliente, o destinatarios externos por email). Permission = View / Download. Opciones
 * avanzadas: expiración, contraseña, máximo de accesos. Los links públicos aparecen
 * deshabilitados si la política del tenant no los permite.
 */
@Component({
  selector: 'app-share-dialog',
  imports: [FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './share-dialog.component.html',
})
export class ShareDialogComponent implements OnChanges {
  @Input() file: FileResponse | null = null;
  @Input() publicAllowed = false;
  @Output() created = new EventEmitter<CreateShareLinkRequest>();
  @Output() cancelled = new EventEmitter<void>();

  /**
   * "Anyone with the link" (Public) solo se ofrece si la oficina lo permite (toggle de Settings).
   * A diferencia de "External recipient" —que acota a un email y exige ?email= en la URL— este link
   * abre para cualquiera que lo tenga, sin identificarse.
   */
  get accessOptions(): AccessOption[] {
    const options: AccessOption[] = [
      { id: 'TenantOnly', title: 'Tenant members', description: 'Anyone signed in to your firm can open it.' },
      { id: 'TenantCustomers', title: 'Client', description: 'The client sees it in their portal.' },
      { id: 'ExternalRecipients', title: 'External recipient', description: 'Only the email you enter can open it.' },
    ];
    if (this.publicAllowed) {
      options.push({
        id: 'Public',
        title: 'Anyone with the link',
        description: 'No sign-in needed — anyone who has the link can open it.',
      });
    }
    return options;
  }

  readonly access = signal<ShareVisibility>('TenantOnly');
  readonly permission = signal<SharePermission>('Download');
  readonly showAdvanced = signal(false);
  readonly expires = signal('');
  readonly password = signal('');
  readonly maxAccess = signal('');
  readonly emails = signal('');
  /** Idioma del email al destinatario externo ('En'/'Es'). Solo aplica a ExternalRecipients. */
  readonly language = signal<'En' | 'Es'>('En');

  ngOnChanges(): void {
    if (this.file) {
      this.access.set('TenantOnly');
      this.permission.set('Download');
      this.showAdvanced.set(false);
      this.expires.set('');
      this.password.set('');
      this.maxAccess.set('');
      this.emails.set('');
      this.language.set('En');
    }
  }

  submit(): void {
    const emailList = this.emails()
      .split(/[,\s]+/)
      .map(e => e.trim())
      .filter(Boolean);
    const req: CreateShareLinkRequest = {
      visibility: this.access(),
      permission: this.permission(),
      password: this.password().trim() || null,
      expiresAtUtc: this.expires() ? new Date(this.expires()).toISOString() : null,
      maxAccessCount: this.maxAccess() ? Number(this.maxAccess()) : null,
      recipientEmails: this.access() === 'ExternalRecipients' ? emailList : null,
      recipientLanguage: this.access() === 'ExternalRecipients' ? this.language() : null,
    };
    this.created.emit(req);
  }
}
