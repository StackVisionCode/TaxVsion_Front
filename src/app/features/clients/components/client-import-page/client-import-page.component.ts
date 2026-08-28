import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ClientImportsStore } from '../../data-access/client-imports.store';
import { CustomerImportAttempt, isTerminalImport } from '../../data-access/client-imports.model';
import {
  ClientImportUploadStepComponent,
  ImportStartRequest,
} from '../../ui/client-import-upload-step/client-import-upload-step.component';
import { ClientImportProgressStepComponent } from '../../ui/client-import-progress-step/client-import-progress-step.component';
import { ClientImportResultStepComponent } from '../../ui/client-import-result-step/client-import-result-step.component';
import { ClientImportHistoryComponent } from '../../ui/client-import-history/client-import-history.component';

type WizardStep = 'upload' | 'progress' | 'result';
type PageTab = 'wizard' | 'history';

interface StepDescriptor {
  key: WizardStep;
  label: string;
}

/**
 * Wizard de importación masiva de clientes (CSV/XLSX) contra
 * `customers/imports` (CustomerImportsController, Customer.Api vía Gateway).
 *
 * Los pasos son los que el contrato permite de verdad:
 *   1. Upload   → POST (multipart + header Idempotency-Key) y GET /template.
 *   2. Progress → sondeo de GET /{id} + POST /{id}/cancel.
 *   3. Result   → GET /{id}/report (json para la tabla, csv para descargar).
 * Y una pestaña de historial sobre GET /customers/imports.
 *
 * NO hay paso de mapeo de columnas ni de previsualización: el POST sólo acepta el archivo
 * y `Strategy`, y no existe endpoint de dry-run. La plantilla de `GET /template` cumple ese
 * papel — sus encabezados son el mapeo que espera el parser.
 *
 * El paso visible se DERIVA del estado del intento (no hay un contador de pasos suelto que
 * pueda quedar desincronizado del backend).
 */
@Component({
  selector: 'app-client-import-page',
  imports: [
    CommonModule,
    RouterModule,
    ClientImportUploadStepComponent,
    ClientImportProgressStepComponent,
    ClientImportResultStepComponent,
    ClientImportHistoryComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  providers: [ClientImportsStore],
  templateUrl: './client-import-page.component.html',
  styleUrl: './client-import-page.component.css',
})
export class ClientImportPageComponent {
  readonly store = inject(ClientImportsStore);

  readonly tab = signal<PageTab>('wizard');

  readonly steps: StepDescriptor[] = [
    { key: 'upload', label: 'Upload file' },
    { key: 'progress', label: 'Import progress' },
    { key: 'result', label: 'Results' },
  ];

  /** Sin intento → subir; intento vivo → progreso; intento terminado → resultado. */
  readonly step = computed<WizardStep>(() => {
    const attempt = this.store.attempt();
    if (!attempt) {
      return 'upload';
    }
    return isTerminalImport(attempt.status) ? 'result' : 'progress';
  });

  readonly currentStepIndex = computed(() => this.steps.findIndex(item => item.key === this.step()));

  constructor() {
    // El historial también alimenta `runningAttempt`: el backend sólo admite una importación
    // activa por tenant, así que conviene saberlo antes de que el POST devuelva 409.
    this.store.loadHistory(1);
  }

  setTab(tab: PageTab): void {
    this.tab.set(tab);
  }

  handleStart(request: ImportStartRequest): void {
    this.store.start(request.file, request.strategy, request.idempotencyKey);
  }

  handleTemplate(): void {
    this.store.downloadTemplate();
  }

  /** Abrir una importación desde el historial o desde el aviso de "ya hay una corriendo". */
  openAttempt(attempt: CustomerImportAttempt): void {
    this.store.track(attempt);
    this.tab.set('wizard');
  }

  handleCancel(): void {
    this.store.cancel();
  }

  handleRetryPoll(): void {
    this.store.retryPolling();
  }

  handleReloadRows(): void {
    const attempt = this.store.attempt();
    if (attempt) {
      this.store.loadReport(attempt.id);
    }
  }

  handleDownloadCsv(): void {
    this.store.downloadReportCsv();
  }

  handleStartAnother(): void {
    this.store.reset();
    this.store.loadHistory(1);
  }

  handleHistoryPage(page: number): void {
    this.store.loadHistory(page);
  }

  handleHistoryRetry(): void {
    this.store.loadHistory(this.store.historyPage());
  }
}
