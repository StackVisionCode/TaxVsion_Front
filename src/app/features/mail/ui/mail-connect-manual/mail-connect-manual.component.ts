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
import { GENERIC_MANUAL_PRESET, ImapSmtpPreset } from '../../data-access/mail-provider-detect.util';

/**
 * Formulario de alta de buzón por IMAP+SMTP (POST /connectors/accounts/manual). Dumb: recibe el email
 * de login (bloqueado — el backend exige que el buzón sea el propio, guard de identidad), un preset
 * opcional de host/puerto según el proveedor detectado, y estado de envío; emite el request al padre.
 *
 * El `emailAddress` NO es editable a propósito: conectar cualquier otro correo devuelve 403
 * (Connectors.EmailIdentity.Mismatch). El username de IMAP/SMTP casi siempre ES el email completo, así
 * que se prellena con el de login y se puede ajustar si el proveedor usa otro usuario.
 */
@Component({
  selector: 'app-mail-connect-manual',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mail-connect-manual.component.html',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class MailConnectManualComponent implements OnChanges {
  /** Email de login: fija `emailAddress` y prellena los usernames. */
  @Input() loginEmail: string | null = null;
  /** Preset del proveedor detectado (null → genérico, el usuario completa host/puerto). */
  @Input() preset: ImapSmtpPreset | null = null;
  /** Nombre legible del proveedor detectado, para el encabezado. */
  @Input() providerLabel = 'your email provider';
  /** Alta en curso (deshabilita el submit). */
  @Input() busy = false;
  /** Error real del backend (conectividad IMAP/SMTP o identidad). */
  @Input() error: string | null = null;

  @Output() submitConnect = new EventEmitter<ConnectManualAccountRequest>();
  @Output() cancel = new EventEmitter<void>();

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
    if (changes['preset']) {
      const preset = this.preset ?? GENERIC_MANUAL_PRESET;
      this.imapHost = preset.imapHost;
      this.imapPort = preset.imapPort;
      this.imapUseSsl = preset.imapUseSsl;
      this.smtpHost = preset.smtpHost;
      this.smtpPort = preset.smtpPort;
      this.smtpUseStartTls = preset.smtpUseStartTls;
    }
    if (changes['loginEmail'] && this.loginEmail) {
      // El username por defecto es el email completo (lo típico); el usuario puede cambiarlo.
      this.imapUsername ||= this.loginEmail;
      this.smtpUsername ||= this.loginEmail;
    }
  }

  get isValid(): boolean {
    return (
      !!this.loginEmail &&
      this.imapHost.trim().length > 0 &&
      this.imapPort > 0 &&
      this.imapUsername.trim().length > 0 &&
      this.imapPassword.length > 0 &&
      this.smtpHost.trim().length > 0 &&
      this.smtpPort > 0 &&
      this.smtpUsername.trim().length > 0 &&
      this.smtpPassword.length > 0
    );
  }

  onSubmit(): void {
    if (!this.isValid || this.busy || !this.loginEmail) {
      return;
    }
    this.submitConnect.emit({
      emailAddress: this.loginEmail,
      displayName: this.displayName.trim() || null,
      imapHost: this.imapHost.trim(),
      imapPort: this.imapPort,
      imapUseSsl: this.imapUseSsl,
      imapUsername: this.imapUsername.trim(),
      imapPassword: this.imapPassword,
      smtpHost: this.smtpHost.trim(),
      smtpPort: this.smtpPort,
      smtpUseStartTls: this.smtpUseStartTls,
      smtpUsername: this.smtpUsername.trim(),
      smtpPassword: this.smtpPassword,
    });
  }
}
