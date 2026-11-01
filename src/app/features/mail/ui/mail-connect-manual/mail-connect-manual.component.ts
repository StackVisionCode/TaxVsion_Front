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
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { FormsModule } from '@angular/forms';
import {
  ConnectManualAccountRequest,
  ManualConnectionCheck,
  TestManualConnectionResult,
} from '../../data-access/mail.model';
import {
  ImapSmtpPreset,
  MANUAL_PROVIDER_OPTIONS,
  ManualProviderOption,
  providerOptionIdFor,
} from '../../data-access/mail-provider-detect.util';
import { ConnectionGuidance, connectionGuidance } from '../../data-access/mail-connection-guidance.util';

/** Fila del resultado de "Test connection" ya lista para pintar. */
export interface ManualTestRow {
  label: string;
  check: ManualConnectionCheck;
  guidance: ConnectionGuidance | null;
}

/**
 * Alta de buzón por IMAP+SMTP (POST /connectors/accounts/manual). Dumb: recibe el email de login, un
 * preset opcional del proveedor detectado, si el alta es del buzón de oficina y el estado de envío y de
 * la prueba; emite el request al padre.
 *
 * Lo común se ve sin ruido: email y contraseña. Servidores, puertos, cifrado y nombre visible quedan en
 * "Advanced settings" ya prellenados por el proveedor (abiertos solo cuando no hay preset que usar).
 * La misma contraseña sirve para entrar y enviar salvo que el usuario marque credenciales distintas.
 *
 * - Personal (asOffice=false): el buzón y el usuario de IMAP/SMTP son el email de login (guard del backend).
 * - Oficina (asOffice=true): email y usuarios editables (un buzón compartido puede autenticarse con otra cuenta).
 *
 * "Test connection" prueba los dos servidores sin guardar; el resultado solo se muestra mientras los datos
 * sigan siendo los probados (cambiar un campo lo invalida).
 */
@Component({
  selector: 'app-mail-connect-manual',
  standalone: true,
  imports: [InfinityLoaderComponent, CommonModule, FormsModule],
  templateUrl: './mail-connect-manual.component.html',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class MailConnectManualComponent implements OnChanges {
  /** Email de login: fija el buzón (personal) y prellena los usuarios. */
  @Input() loginEmail: string | null = null;
  /** Preset del proveedor detectado (null → se elige en Advanced settings; genérico por defecto). */
  @Input() preset: ImapSmtpPreset | null = null;
  /** Nombre legible del proveedor detectado, para el encabezado. */
  @Input() providerLabel = 'your email provider';
  /** true = alta del buzón de oficina: email y usuarios editables (el backend salta el guard). */
  @Input() asOffice = false;
  /** Alta en curso (deshabilita los botones). */
  @Input() busy = false;
  /** Error real del alta (conectividad IMAP/SMTP o identidad). */
  @Input() error: string | null = null;
  /** Prueba en curso, su resultado y un error de la petición (p. ej. identidad o límite de intentos). */
  @Input() testing = false;
  @Input() testResult: TestManualConnectionResult | null = null;
  @Input() testError: string | null = null;

  @Output() submitConnect = new EventEmitter<ConnectManualAccountRequest>();
  @Output() testConnection = new EventEmitter<ConnectManualAccountRequest>();
  @Output() cancel = new EventEmitter<void>();

  readonly providers = MANUAL_PROVIDER_OPTIONS;
  selectedProviderId = 'custom';
  showAdvanced = false;
  /** Credenciales propias para el servidor de salida (si no, se reusan las de entrada). */
  separateSmtpCredentials = false;

  /** Solo se usa en modo oficina (editable); en personal el buzón es siempre `loginEmail`. */
  emailAddress = '';
  displayName = '';
  password = '';
  imapHost = '';
  imapPort = 993;
  imapUseSsl = true;
  imapUsername = '';
  smtpHost = '';
  smtpPort = 587;
  smtpUseStartTls = true;
  smtpUsername = '';
  smtpPassword = '';

  /** Datos con los que se pidió la última prueba: si cambian, su resultado ya no aplica. */
  private testedKey: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['preset'] || changes['asOffice']) {
      // Proveedor inicial: el detectado; sin preset, oficina asume Microsoft 365 (lo más común en un
      // despacho) y personal queda en "Other" con los servidores a la vista para completarlos.
      this.selectedProviderId = providerOptionIdFor(this.preset) ?? (this.asOffice ? 'office365' : 'custom');
      this.applySelectedProvider();
      this.showAdvanced = this.selectedProviderId === 'custom';
    }
    if (changes['loginEmail'] && this.loginEmail && !this.asOffice) {
      this.emailAddress = this.loginEmail;
    }
  }

  /** El email efectivo del buzón: editable en oficina, fijo al login en personal. */
  get effectiveEmail(): string {
    return this.asOffice ? this.emailAddress.trim() : (this.loginEmail ?? '');
  }

  /** Usuario de entrada. Personal: siempre el email. Oficina: el tecleado o, vacío, el email. */
  get effectiveImapUsername(): string {
    return this.asOffice ? this.imapUsername.trim() || this.effectiveEmail : this.effectiveEmail;
  }

  get effectiveSmtpUsername(): string {
    if (this.asOffice && this.separateSmtpCredentials) {
      return this.smtpUsername.trim() || this.effectiveEmail;
    }
    return this.effectiveImapUsername;
  }

  get effectiveSmtpPassword(): string {
    return this.separateSmtpCredentials ? this.smtpPassword : this.password;
  }

  /** Cambió el proveedor: reaplica host/puerto/cifrado (no toca usuario ni contraseña). */
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

  get isValid(): boolean {
    const email = this.effectiveEmail;
    return (
      email.includes('@') &&
      this.imapHost.trim().length > 0 &&
      this.imapPort > 0 &&
      this.password.length > 0 &&
      this.smtpHost.trim().length > 0 &&
      this.smtpPort > 0 &&
      this.effectiveSmtpPassword.length > 0
    );
  }

  /** Falta el servidor (proveedor "Other"): se avisa en vez de dejar el botón apagado sin explicación. */
  get missingServers(): boolean {
    return !this.imapHost.trim() || !this.smtpHost.trim();
  }

  private buildRequest(): ConnectManualAccountRequest {
    return {
      emailAddress: this.effectiveEmail,
      displayName: this.displayName.trim() || null,
      imapHost: this.imapHost.trim(),
      imapPort: this.imapPort,
      imapUseSsl: this.imapUseSsl,
      imapUsername: this.effectiveImapUsername,
      imapPassword: this.password,
      smtpHost: this.smtpHost.trim(),
      smtpPort: this.smtpPort,
      smtpUseStartTls: this.smtpUseStartTls,
      smtpUsername: this.effectiveSmtpUsername,
      smtpPassword: this.effectiveSmtpPassword,
      asOffice: this.asOffice,
    };
  }

  /** Huella de lo que se prueba (sin el nombre visible, que no afecta a la conexión). */
  private keyOf(request: ConnectManualAccountRequest): string {
    const { displayName: _ignored, ...connection } = request;
    return JSON.stringify(connection);
  }

  onTest(): void {
    if (!this.isValid || this.testing || this.busy) {
      return;
    }
    const request = this.buildRequest();
    this.testedKey = this.keyOf(request);
    this.testConnection.emit(request);
  }

  /** El resultado mostrado es el de los datos actuales; si el usuario cambió algo, se oculta. */
  get currentTestResult(): TestManualConnectionResult | null {
    if (!this.testResult || this.testedKey === null) {
      return null;
    }
    return this.keyOf(this.buildRequest()) === this.testedKey ? this.testResult : null;
  }

  get testRows(): ManualTestRow[] {
    const result = this.currentTestResult;
    if (!result) {
      return [];
    }
    return [
      {
        label: 'Incoming mail (IMAP)',
        check: result.imap,
        guidance: connectionGuidance(result.imap, 'imap', this.selectedProviderId),
      },
      {
        label: 'Outgoing mail (SMTP)',
        check: result.smtp,
        guidance: connectionGuidance(result.smtp, 'smtp', this.selectedProviderId),
      },
    ];
  }

  get testPassed(): boolean {
    const result = this.currentTestResult;
    return !!result && result.imap.ok && result.smtp.ok;
  }

  onSubmit(): void {
    if (!this.isValid || this.busy) {
      return;
    }
    this.submitConnect.emit(this.buildRequest());
  }
}
