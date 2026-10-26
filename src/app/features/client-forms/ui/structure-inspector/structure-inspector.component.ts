import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import {
  FormSelectControlComponent,
  type FormControlOption,
} from '@shared/ui/form-controls/form-select-control.component';
import { FormTextControlComponent } from '@shared/ui/form-controls/form-text-control.component';
import { RichTextEditorComponent } from '@shared/ui/rich-text-editor/rich-text-editor.component';
import type { Condition } from '@shared/utils/data-collection/conditions';
import type {
  FormComponent,
  FormDefinition,
  FormMapping,
  FormPage,
  FormRepeat,
  FormSection,
  FormStyle,
} from '@shared/utils/data-collection/form-definition.model';
import type { RichTextDocument } from '@shared/utils/data-collection/rich-text';
import { ConditionEditorComponent } from '../condition-editor/condition-editor.component';
import { RepeaterSettingsComponent } from '../repeater-settings/repeater-settings.component';
import { RepeaterMappingEditorComponent } from '../repeater-mapping-editor/repeater-mapping-editor.component';
import type { MappingCatalog } from '../../data-access/mapping-catalog.model';

@Component({
  selector: 'app-structure-inspector',
  imports: [
    ConditionEditorComponent,
    FormSelectControlComponent,
    FormTextControlComponent,
    RepeaterSettingsComponent,
    RepeaterMappingEditorComponent,
    RichTextEditorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      class="block px-4 py-4"
      aria-label="Page and section settings"
    >
      @if (disabled) {
        <p class="mb-4 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" role="status">
          Editing is paused in this tab.
        </p>
      }
      <!-- Solo lectura: fieldset deshabilita los controles nativos e inert cubre el editor de texto. -->
      <fieldset
        class="m-0 min-w-0 border-0 p-0"
        [disabled]="disabled"
        [attr.inert]="disabled ? '' : null"
        [attr.aria-disabled]="disabled"
        data-builder-inspector
      >
      @if (page || section) {
        <p class="text-xs font-semibold uppercase text-brand-bold">
          {{ section ? 'Section' : 'Page' }}
        </p>
        <h2 class="mt-1 text-base font-bold text-gray-900">
          {{ section ? 'Section settings' : 'Page settings' }}
        </h2>
        <div class="mt-5 space-y-4">
          <label class="block text-xs font-semibold text-gray-600"
            >Title<app-form-text-control
              class="mt-1 block"
              [value]="itemTitle()"
              [maxLength]="160"
              (valueChange)="patchTitle($event)"
          /></label>
          <div>
            <span
              [id]="'structure-description-label-' + (section?.id ?? page?.id)"
              class="text-xs font-semibold text-gray-600"
              >Description</span
            ><app-rich-text-editor
              class="mt-1 block"
              [ariaLabelledby]="'structure-description-label-' + (section?.id ?? page?.id)"
              [document]="itemDescription()"
              (documentChange)="patchDescription($event)"
            />
          </div>
          @if (section) {
            <app-repeater-settings
              [repeat]="section.repeat || null"
              (repeatChange)="patchRepeat($event)"
            />
            <!-- Mapeo de repeater a una colección del cliente (P-16, rowFields); exige configure_actions. -->
            @if (section.repeat && canMap && definition) {
              <div class="border-t border-gray-100 pt-4" data-testid="structure-mapping">
                @defer {
                <app-repeater-mapping-editor
                  [definition]="definition"
                  [sectionId]="section.id"
                  [catalog]="mappingCatalog"
                  [loading]="mappingLoading"
                  [error]="mappingError"
                  [disabled]="disabled"
                  (mappingChange)="mappingChange.emit($event)"
                  (retry)="mappingRetry.emit()"
                />
                } @placeholder {
                  <p class="text-xs text-gray-500">Loading…</p>
                }
              </div>
            }
          }
          <section class="border-t border-gray-100 pt-4">
            <h3 class="text-sm font-bold text-gray-900">Layout</h3>
            <div class="mt-3 space-y-3">
              @if (section) {
                <label class="block text-xs font-semibold text-gray-600"
                  >Width<app-form-select-control
                    class="mt-1 block"
                    [value]="itemStyle().width || 'full'"
                    [options]="widthOptions"
                    [placeholder]="''"
                    (valueChange)="patchStyle('width', $event)"
                /></label>
              }
              <label class="block text-xs font-semibold text-gray-600"
                >Background<app-form-select-control
                  class="mt-1 block"
                  [value]="itemStyle().background || 'none'"
                  [options]="backgroundOptions"
                  [placeholder]="''"
                  (valueChange)="patchStyle('background', $event)"
              /></label>
              <div class="grid grid-cols-2 gap-3">
                <label class="block text-xs font-semibold text-gray-600"
                  >Space above<app-form-select-control
                    class="mt-1 block"
                    [value]="String(itemStyle().spacingTop ?? 0)"
                    [options]="spacingOptions"
                    [placeholder]="''"
                    (valueChange)="patchStyle('spacingTop', Number($event))"
                /></label>
                <label class="block text-xs font-semibold text-gray-600"
                  >Space below<app-form-select-control
                    class="mt-1 block"
                    [value]="String(itemStyle().spacingBottom ?? 0)"
                    [options]="spacingOptions"
                    [placeholder]="''"
                    (valueChange)="patchStyle('spacingBottom', Number($event))"
                /></label>
              </div>
            </div>
          </section>
          <app-condition-editor
            [condition]="itemCondition()"
            [fields]="earlierFields"
            (conditionChange)="patchCondition($event)"
          />
        </div>
      } @else {
        <div class="flex min-h-48 items-center justify-center text-center">
          <p class="max-w-48 text-sm text-gray-500">Select a page, section or field to edit it.</p>
        </div>
      }
      </fieldset>
    </aside>
  `,
})
export class StructureInspectorComponent {
  @Input() page: FormPage | null = null;
  /** Otra pestaña tiene el control o hay un conflicto: no se acepta ninguna edición. */
  @Input() disabled = false;
  @Input() section: FormSection | null = null;
  @Input() earlierFields: FormComponent[] = [];
  @Output() readonly pageChange = new EventEmitter<Partial<FormPage>>();
  @Output() readonly sectionChange = new EventEmitter<Partial<FormSection>>();
  /** Quien la usa decide con `tasks.form_templates.configure_actions`. */
  @Input() canMap = false;
  @Input() definition: FormDefinition | null = null;
  @Input() mappingCatalog: MappingCatalog | null = null;
  @Input() mappingLoading = false;
  @Input() mappingError = '';
  @Output() readonly mappingChange = new EventEmitter<FormMapping | null>();
  @Output() readonly mappingRetry = new EventEmitter<void>();
  readonly String = String;
  readonly Number = Number;
  readonly widthOptions = options(['full', 'half', 'third', 'twoThirds']);
  readonly backgroundOptions = options([
    'none',
    'surface',
    'sunken',
    'brandSubtle',
    'accentSubtle',
    'sand',
    'sage',
  ]);
  readonly spacingOptions = options(['0', '2', '4', '6', '8']);

  itemTitle(): string {
    return this.section?.title ?? this.page?.title ?? '';
  }

  itemDescription(): RichTextDocument | null {
    return this.section?.description ?? this.page?.description ?? null;
  }

  itemStyle(): FormStyle {
    return this.section?.style ?? this.page?.style ?? {};
  }

  itemCondition(): Condition | null {
    return this.section?.visibleWhen ?? this.page?.visibleWhen ?? null;
  }

  patchTitle(title: string): void {
    this.emit({ title });
  }

  patchDescription(description: RichTextDocument): void {
    this.emit({ description });
  }

  patchRepeat(repeat: FormRepeat | null): void {
    this.sectionChange.emit({ repeat });
  }

  patchStyle(key: keyof FormStyle, value: string | number): void {
    this.emit({ style: { ...this.itemStyle(), [key]: value } });
  }

  patchCondition(visibleWhen: Condition | null): void {
    this.emit({ visibleWhen });
  }

  private emit(update: Partial<FormPage> & Partial<FormSection>): void {
    if (this.section) this.sectionChange.emit(update);
    else if (this.page) this.pageChange.emit(update);
  }
}

function options(values: readonly string[]): FormControlOption[] {
  return values.map((value) => ({
    value,
    label: value.replace(/([A-Z])/g, ' $1').replace(/^./, (item) => item.toUpperCase()),
  }));
}
