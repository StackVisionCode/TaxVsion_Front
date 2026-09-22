import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConnectManualAccountRequest } from '../../data-access/mail.model';
import {
  GENERIC_MANUAL_PRESET,
  ImapSmtpPreset,
  MANUAL_PROVIDER_OPTIONS,
  ManualProviderOption,
  providerOptionIdFor,
} from '../../data-access/mail-provider-detect.util';

/**
 * Formulario de alta de buzón por IMAP+SMTP (POST /connectors/accounts/manual). Dumb: recibe el email
 * de login, un preset opcional del proveedor detectado, si el alta es del buzón de oficina y estado de
 * envío; emite el request al padre.
 *
 * Dos modos según `asOffice`:
 * - Personal (asOffice=false): `emailAddress` = email de login, bloqueado. Conectar otro correo
 *   devuelve 403 (guard de identidad del backend).
 * - Oficina (asOffice=true): `emailAddress` es editable (el buzón compartido casi nunca es el login
 *   del admin); el backend salta el guard para oficina.
 *
 * Un dropdown de proveedor prellena host/puerto/cifrado (Microsoft 365 / Gmail / Yahoo / iCloud /
 * Zoho / otro). El username de IMAP/SMTP casi siempre ES el email completo, así que se prellena y se
 * puede ajustar si el proveedor usa otro usuario.
 */
@Component({
  selector: 'app-mail-connect-manual',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mail-connect-manual.component.html',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class MailConnectManualComponent implements OnChanges {
  /** Email de login: fija `emailAddress` (personal) y prellena los usernames. */
  @Input() loginEmail: string | null = null;
  /** Preset del proveedor detectado (null → se elige en el dropdown; genérico por defecto). */
  @Input() preset: ImapSmtpPreset | null = null;
  /** Nombre legible del proveedor detectado, para el encabezado. */
  @Input() providerLabel = 'your email provider';
  /** true = alta del buzón de oficina: `emailAddress` editable (el backend salta el guard). */
  @Input() asOffice = false;
  /** Alta en curso (deshabilita el submit). */
  @Input() busy = false;
  /** Error real del backend (conectividad IMAP/SMTP o identidad). */
  @Input() error: string | null = null;

  @Output() submitConnect = new EventEmitter<ConnectManualAccountRequest>();
  @Output() cancel = new EventEmitter<void>();

  readonly providers = MANUAL_PROVIDER_OPTIONS;
  selectedProviderId = 'custom';

  /** Solo se usa en modo oficina (editable); en personal el buzón es siempre `loginEmail`. */
  emailAddress = '';
  displayName = '';
  imapHost = '';
  imapPort = 993;
  imapUseSsl = true;
  imapUsername = '';
  imapPassword = '';
  smtpHost = '';
  smtpPort = 587;
  smtpUseStartTls = true;
  smtpUsername = '';
  smtpPassword = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['preset'] || changes['asOffice']) {
      // El proveedor inicial sale del preset detectado; si no hay, oficina asume Microsoft 365 (lo
      // más común en un despacho) y personal queda en genérico para que el usuario lo elija.
      this.selectedProviderId =
        providerOptionIdFor(this.preset) ?? (this.asOffice ? 'office365' : 'custom');
      this.applySelectedProvider();
    }
    if (changes['loginEmail'] && this.loginEmail && !this.asOffice) {
      // Personal: la identidad es el email de login; el username de IMAP/SMTP ES ese mismo email
      // (los proveedores de consumidor lo usan como usuario) — no se pide aparte para no confundir ni
      // permitir apuntar a un buzón ajeno bajo tu identidad. En oficina el username sí es editable.
      this.emailAddress = this.loginEmail;
    }
  }

  /** El email efectivo del buzón: editable en oficina, fijo al login en personal. */
  get effectiveEmail(): string {
    return this.asOffice ? this.emailAddress.trim() : (this.loginEmail ?? '');
  }

  /**
   * Usuario de login del servidor. Personal: SIEMPRE el email del buzón (no editable). Oficina: lo que
   * el admin teclee (un buzón compartido puede autenticarse con una cuenta de servicio distinta).
   */
  get effectiveImapUsername(): string {
    return this.asOffice ? this.imapUsername.trim() : this.effectiveEmail;
  }

  get effectiveSmtpUsername(): string {
    return this.asOffice ? this.smtpUsername.trim() : this.effectiveEmail;
  }

  /** Cambió el proveedor del dropdown: reaplica host/puerto/cifrado (no toca usuario/contraseña). */
  onProviderChange(): void {
    this.applySelectedProvider();
  }

  private applySelectedProvider(): void {
    const option: ManualProviderOption =
      this.providers.find(p => p.id === this.selectedProviderId) ?? this.providers[this.providers.length - 1];
    this.imapHost = option.preset.imapHost;
    this.imapPort = option.preset.imapPort;
    this.imapUseSsl = option.preset.imapUseSsl;
    this.smtpHost = option.preset.smtpHost;
    this.smtpPort = option.preset.smtpPort;
    this.smtpUseStartTls = option.preset.smtpUseStartTls;
  }

  /** En oficina, al teclear el email se prellenan los usernames vacíos (suelen ser el email completo). */
  onEmailChange(): void {
    if (this.asOffice && this.emailAddress.trim()) {
      this.imapUsername ||= this.emailAddress.trim();
      this.smtpUsername ||= this.emailAddress.trim();
    }
  }

  get isValid(): boolean {
    const email = this.effectiveEmail;
    return (
      email.length > 0 &&
      email.includes('@') &&
      this.imapHost.trim().length > 0 &&
      this.imapPort > 0 &&
      this.effectiveImapUsername.length > 0 &&
      this.imapPassword.length > 0 &&
      this.smtpHost.trim().length > 0 &&
      this.smtpPort > 0 &&
      this.effectiveSmtpUsername.length > 0 &&
      this.smtpPassword.length > 0
    );
  }

  onSubmit(): void {
    if (!this.isValid || this.busy) {
      return;
    }
    this.submitConnect.emit({
      emailAddress: this.effectiveEmail,
      displayName: this.displayName.trim() || null,
      imapHost: this.imapHost.trim(),
      imapPort: this.imapPort,
      imapUseSsl: this.imapUseSsl,
      imapUsername: this.effectiveImapUsername,
      imapPassword: this.imapPassword,
      smtpHost: this.smtpHost.trim(),
      smtpPort: this.smtpPort,
      smtpUseStartTls: this.smtpUseStartTls,
      smtpUsername: this.effectiveSmtpUsername,
      smtpPassword: this.smtpPassword,
      asOffice: this.asOffice,
    });
  }
}
