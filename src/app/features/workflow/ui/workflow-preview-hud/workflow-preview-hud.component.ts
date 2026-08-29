import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PreviewStatus } from '../../data-access/workflow-preview.service';

/**
 * Marcador de la simulación: progreso, tiempo simulado y controles.
 * Presentacional puro; el motor vive en `WorkflowPreviewService`.
 */
@Component({
  selector: 'app-workflow-preview-hud',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-preview-hud.component.html',
  styleUrl: './workflow-preview-hud.component.css',
})
export class WorkflowPreviewHudComponent {
  @Input() status: PreviewStatus = 'idle';
  @Input() doneCount = 0;
  @Input() runCount = 0;
  @Input() elapsedLabel = '';
  @Input() totalLabel = '';

  @Output() stopRun = new EventEmitter<void>();
  @Output() rerun = new EventEmitter<void>();
  @Output() closeHud = new EventEmitter<void>();
}
