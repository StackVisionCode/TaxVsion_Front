import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Panel presentacional de códigos de recuperación: se muestra UNA sola vez
 * (tras activar MFA o tras regenerarlos) con copia al portapapeles y descarga
 * .txt. No hace llamadas: los códigos siempre llegan del backend por input.
 * Se extrae aparte porque lo consumen dos flujos (alta y regeneración).
 */
@Component({
  selector: 'app-recovery-codes-panel',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './recovery-codes-panel.component.html',
  styleUrl: './recovery-codes-panel.component.css',
})
export class RecoveryCodesPanelComponent implements OnDestroy {
  @Input() codes: string[] = [];

  readonly copied = signal(false);
  readonly copyError = signal<string | null>(null);
  private copyTimer?: ReturnType<typeof setTimeout>;

  ngOnDestroy(): void {
    clearTimeout(this.copyTimer);
  }

  copyCodes(): void {
    const text = this.codes.join('\n');
    if (!text) {
      return;
    }
    this.copyError.set(null);
    // El portapapeles solo existe en contextos seguros; si falla, el usuario
    // todavía puede seleccionar los códigos a mano o descargarlos.
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      this.copyError.set('Copy failed — select the codes manually or download them.');
      return;
    }
    clipboard
      .writeText(text)
      .then(() => this.flagCopied())
      .catch(() => this.copyError.set('Copy failed — select the codes manually or download them.'));
  }

  /** Descarga los códigos como .txt para guardarlos offline. */
  downloadCodes(): void {
    if (this.codes.length === 0) {
      return;
    }
    const body =
      'TaxPro Office — Recovery codes\n\n' +
      'Keep these somewhere safe. Each code can be used once to sign in if you lose your device.\n\n' +
      this.codes.join('\n') +
      '\n';
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'taxproffice-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  private flagCopied(): void {
    this.copied.set(true);
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => this.copied.set(false), 2500);
  }
}
