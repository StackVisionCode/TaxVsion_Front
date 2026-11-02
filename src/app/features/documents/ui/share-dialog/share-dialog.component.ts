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
import { SharingPolicy } from '@core/cloud-storage/cloud-storage.model';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import {
  CreateShareLinkRequest,
  CreateFolderShareLinkRequest,
  FileResponse,
  FolderResponse,
  SharePermission,
  ShareLinkResponse,
  ShareVisibility,
} from '../../data-access/documents.model';

interface AccessOption {
  id: ShareVisibility;
  title: string;
  description: string;
}

/** Enlaces que salen de la oficina: a ellos aplican vida máxima y tope de descargas de la política. */
const EXTERNAL_VISIBILITIES: ReadonlySet<ShareVisibility> = new Set(['Public', 'ExternalLink', 'ExternalRecipients']);

/** Enlaces que abren sin sesión ni email: a ellos aplica la contraseña obligatoria de la oficina. */
const LINK_ONLY_VISIBILITIES: ReadonlySet<ShareVisibility> = new Set(['Public', 'ExternalLink']);

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
  @Input() folder: FolderResponse | null = null;
  /**
   * Si la oficina permite enlaces públicos. Tres estados y no un booleano: el ajuste se lee de
   * `GET /storage/usage`, que exige `cloudstorage.settings.manage`. Un empleado recibe 403, y con
   * un booleano eso se volvía `false` — o sea, la pantalla afirmaba "Turned off by your firm"
   * cuando en realidad no había podido preguntarlo. Ahora "no lo sé" se dice.
   */
  @Input() publicSharing: 'enabled' | 'disabled' | 'unknown' = 'unknown';
  /**
   * Reglas de compartir de la oficina (`GET /storage/shares/policy`). Sin ellas el diálogo no inventa
   * topes: deja que el backend responda.
   */
  @Input() policy: SharingPolicy | null = null;
  @Input() shares: ShareLinkResponse[] = [];
  @Output() created = new EventEmitter<CreateShareLinkRequest>();
  @Output() createdFolder = new EventEmitter<CreateFolderShareLinkRequest>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() revokeShare = new EventEmitter<string>();
  @Output() reshare = new EventEmitter<ShareLinkResponse>();

  get isFolder(): boolean {
    return !!this.folder;
  }

  get targetName(): string {
    return this.folder?.name ?? this.file?.originalName ?? '';
  }

  /** Links vigentes del archivo (para mostrar "ya compartido" en vez de arrancar en blanco). */
  get activeShares(): ShareLinkResponse[] {
    return this.shares.filter(s => s.status === 'Active');
  }

  accessLabel(visibility: ShareVisibility): string {
    switch (visibility) {
      case 'Public':
        return 'Anyone with the link';
      case 'ExternalLink':
        return 'Secure link';
      case 'ExternalRecipients':
        return 'External recipient';
      case 'TenantCustomers':
        return 'Client';
      case 'SpecificUsers':
        return 'Specific people';
      default:
        return 'Office team';
    }
  }

  /** Public y Secure link (ExternalLink) producen una URL copiable (re-compartir = revocar viejo + crear nuevo). */
  isCopyable(share: ShareLinkResponse): boolean {
    return share.visibility === 'Public' || share.visibility === 'ExternalLink';
  }

  /** true si hay algún link copiable activo (para mostrar la nota del "Copy link"). */
  hasCopyableShares(): boolean {
    return this.activeShares.some(s => this.isCopyable(s));
  }

  /** Nota de por qué un link no se copia (según su tipo). */
  noCopyReason(share: ShareLinkResponse): string {
    return share.visibility === 'ExternalRecipients' ? 'Sent by email' : 'Opens in the app';
  }

  expiryLabel(iso: string | null): string {
    if (!iso) {
      return 'No expiry';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
    if (days <= 0) {
      return 'Expired';
    }
    if (days === 1) {
      return 'Expires tomorrow';
    }
    return days <= 30
      ? `Expires in ${days} days`
      : `Until ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  /**
   * "Anyone with the link" (Public) solo se ofrece si la oficina lo permite (toggle de Settings).
   * A diferencia de "External recipient" —que acota a un email y exige ?email= en la URL— este link
   * abre para cualquiera que lo tenga, sin identificarse.
   */
  get accessOptions(): AccessOption[] {
    const options: AccessOption[] = [
      { id: 'TenantOnly', title: 'Office team', description: 'Anyone signed in to your firm can open it.' },
      { id: 'TenantCustomers', title: 'Client', description: 'The client sees it in their portal.' },
      { id: 'ExternalRecipients', title: 'External recipient', description: 'Only the email you enter can open it.' },
    ];
    // La oficina puede apagar el enlace sin email desde Settings → Documents.
    if (this.policy?.allowLinkOnlyExternalShares !== false) {
      options.push({
        id: 'ExternalLink',
        title: 'Secure link',
        description: 'Anyone with the link can open it — no email needed. Always expires and can be revoked.',
      });
    }
    // Con 'unknown' no se ofrece: proponer un enlace público que el backend va a rechazar es peor
    // que no proponerlo. El aviso de abajo explica por qué no está.
    if (this.publicSharing === 'enabled') {
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
  readonly expires = signal('');
  readonly password = signal('');
  readonly maxAccess = signal('');
  readonly emails = signal('');
  /** Idioma del email al destinatario externo ('En'/'Es'). Solo aplica a ExternalRecipients. */
  readonly language = signal<'En' | 'Es'>('En');
  /** Solo carpetas: incluir subcarpetas (recursivo) y lo que se agregue después. */
  readonly includeSubfolders = signal(true);
  readonly includeFutureItems = signal(true);

  ngOnChanges(): void {
    if (this.file || this.folder) {
      this.access.set('TenantOnly');
      this.permission.set('Download');
      this.expires.set('');
      this.password.set('');
      this.maxAccess.set('');
      this.emails.set('');
      this.language.set('En');
      this.includeSubfolders.set(true);
      this.includeFutureItems.set(true);
    }
  }

  /** Mínimo del date-picker: mañana (hora local) — evita expiraciones "hoy/pasadas" al convertir a UTC. */
  get minExpiry(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return ShareDialogComponent.toDateInput(d);
  }

  /** true si el acceso elegido sale de la oficina (público, solo-link o destinatario externo). */
  get isExternal(): boolean {
    return EXTERNAL_VISIBILITIES.has(this.access());
  }

  /** Máximo del date-picker: los enlaces externos no pasan la vida máxima de la oficina. */
  get maxExpiry(): string | null {
    if (!this.isExternal || !this.policy) {
      return null;
    }
    const d = new Date();
    d.setDate(d.getDate() + this.policy.maxLifetimeDays);
    return ShareDialogComponent.toDateInput(d);
  }

  /** Texto bajo la fecha: lo que pasa si no se elige y hasta cuándo se puede. */
  get expiryHint(): string {
    if (!this.policy) {
      return 'Leave empty for your office default.';
    }
    const base = `Leave empty for the default ${this.policy.defaultLifetimeDays} days.`;
    return this.isExternal ? `${base} Up to ${this.policy.maxLifetimeDays} days.` : base;
  }

  /** La oficina exige contraseña en los enlaces que abren sin sesión ni email. */
  get passwordRequired(): boolean {
    return !!this.policy?.requirePasswordOnLinkShares && LINK_ONLY_VISIBILITIES.has(this.access());
  }

  /** Motivo por el que la contraseña no sirve todavía (vacía si está bien). */
  get passwordError(): string {
    const value = this.password().trim();
    if (!value) {
      return this.passwordRequired ? 'Your office requires a password for this kind of link.' : '';
    }
    const min = this.policy?.minPasswordLength ?? 0;
    return value.length < min ? `Use at least ${min} characters.` : '';
  }

  /** Tope de descargas de la oficina para enlaces externos (null = sin tope). */
  get maxDownloads(): number | null {
    return this.isExternal ? (this.policy?.maxDownloads ?? null) : null;
  }

  get maxAccessError(): string {
    const raw = this.maxAccess().trim();
    if (!raw) {
      return '';
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      return 'Enter a whole number.';
    }
    const cap = this.maxDownloads;
    return cap !== null && value > cap ? `Your office allows up to ${cap} opens.` : '';
  }

  get canSubmit(): boolean {
    return !this.passwordError && !this.maxAccessError;
  }

  /** yyyy-mm-dd en hora LOCAL (el <input type="date"> trabaja en local, no UTC). */
  private static toDateInput(d: Date): string {
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
  }

  submit(): void {
    if (!this.canSubmit) {
      return;
    }
    const emailList = this.emails()
      .split(/[,\s]+/)
      .map(e => e.trim())
      .filter(Boolean);
    const base: CreateShareLinkRequest = {
      visibility: this.access(),
      permission: this.permission(),
      password: this.password().trim() || null,
      // Fin del día LOCAL elegido → el link vale todo ese día y nunca cae "en el pasado" por
      // interpretar la fecha como medianoche UTC.
      expiresAtUtc: this.expires() ? new Date(`${this.expires()}T23:59:59`).toISOString() : null,
      maxAccessCount: this.maxAccess() ? Number(this.maxAccess()) : null,
      recipientEmails: this.access() === 'ExternalRecipients' ? emailList : null,
      recipientLanguage: this.access() === 'ExternalRecipients' ? this.language() : null,
    };
    if (this.isFolder) {
      this.createdFolder.emit({
        ...base,
        isRecursive: this.includeSubfolders(),
        appliesToFutureItems: this.includeFutureItems(),
      });
    } else {
      this.created.emit(base);
    }
  }
}
