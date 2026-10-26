import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { FormAction, FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import type { MappingCatalog } from '../../data-access/mapping-catalog.model';
import type { MappingRemoval } from '../../utils/mapping-mutations';
import { AfterSubmissionPanelComponent } from '../after-submission-panel/after-submission-panel.component';
import { MappingCoveragePanelComponent } from '../mapping-coverage-panel/mapping-coverage-panel.component';

/**
 * Envoltorio de las pestañas de plantilla "After submission" y "Mapping coverage": las difiere
 * para que su código baje recién al abrirlas y no engorde el chunk del builder.
 */
@Component({
  selector: 'app-template-settings-panel',
  imports: [AfterSubmissionPanelComponent, MappingCoveragePanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (panel() === 'actions') {
      @defer {
        <app-after-submission-panel
          [definition]="definition()"
          [catalog]="catalog()"
          [catalogLoading]="catalogLoading()"
          [modules]="modules()"
          [autoCustomerCreationEnabled]="autoCustomerCreationEnabled()"
          [signatureStepEnabled]="signatureStepEnabled()"
          [disabled]="disabled()"
          (actionsChange)="actionsChange.emit($event)"
          (coverageRequested)="coverageRequested.emit($event)"
        />
      } @placeholder {
        <p class="text-xs text-gray-500">Loading…</p>
      }
    } @else {
      @defer {
        <app-mapping-coverage-panel
          [definition]="definition()"
          [catalog]="catalog()"
          [loading]="catalogLoading()"
          [error]="catalogError()"
          [disabled]="disabled()"
          [focusActionKey]="focusActionKey()"
          (componentSelected)="componentSelected.emit($event)"
          (mappingRemoved)="mappingRemoved.emit($event)"
          (actionSelected)="actionSelected.emit($event)"
          (retry)="retry.emit()"
        />
      } @placeholder {
        <p class="text-xs text-gray-500">Loading…</p>
      }
    }
  `,
})
export class TemplateSettingsPanelComponent {
  readonly panel = input.required<'actions' | 'coverage'>();
  readonly definition = input.required<FormDefinition>();
  readonly catalog = input<MappingCatalog | null>(null);
  readonly catalogLoading = input(false);
  readonly catalogError = input('');
  readonly modules = input<ReadonlySet<string> | null>(null);
  readonly autoCustomerCreationEnabled = input<boolean | null>(null);
  readonly signatureStepEnabled = input<boolean | null>(null);
  readonly disabled = input(false);
  readonly focusActionKey = input<string | null>(null);

  readonly actionsChange = output<FormAction[]>();
  readonly coverageRequested = output<string>();
  readonly componentSelected = output<string>();
  readonly mappingRemoved = output<MappingRemoval>();
  readonly actionSelected = output<string>();
  readonly retry = output<void>();
}
