import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
} from '@angular/core';
import type {
  FormComponent,
  FormDefinition,
  FormMapping,
  FormStyle,
} from '@shared/utils/data-collection/form-definition.model';
import type { Condition } from '@shared/utils/data-collection/conditions';
import { getComponentType } from '@shared/utils/data-collection/component-registry';
import { ConditionEditorComponent } from '../condition-editor/condition-editor.component';
import { RichTextEditorComponent } from '@shared/ui/rich-text-editor/rich-text-editor.component';
import type { RichTextDocument } from '@shared/utils/data-collection/rich-text';
import { FormCheckboxControlComponent } from '@shared/ui/form-controls/form-checkbox-control.component';
import {
  FormSelectControlComponent,
  type FormControlOption,
} from '@shared/ui/form-controls/form-select-control.component';
import { FormTextControlComponent } from '@shared/ui/form-controls/form-text-control.component';
import { SegmentedComponent, type SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { componentTypeLabel } from '../../utils/component-catalog';
import type { MappingCatalog } from '../../data-access/mapping-catalog.model';
import { FieldMappingEditorComponent } from '../field-mapping-editor/field-mapping-editor.component';
import { OptionListEditorComponent } from '../option-list-editor/option-list-editor.component';
import { componentOptions, type ComponentOption } from '../../utils/mapping-compatibility';
import { mappingFor } from '../../utils/mapping-mutations';

/** Pestañas del inspector de campo. */
export type InspectorTab = 'settings' | 'display' | 'logic' | 'mapping';

const DATA_CLASSES = ['general', 'financial', 'personal', 'restricted'] as const;

@Component({
  selector: 'app-component-inspector',
  imports: [
    ConditionEditorComponent,
    RichTextEditorComponent,
    FormCheckboxControlComponent,
    FormSelectControlComponent,
    FormTextControlComponent,
    SegmentedComponent,
    FieldMappingEditorComponent,
    OptionListEditorComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      class="block px-4 py-4"
      aria-label="Component settings"
    >
      @if (disabled) {
        <p class="mb-4 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" role="status">
          Editing is paused in this tab.
        </p>
      }
      @if (component) {
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-xs font-semibold uppercase text-brand-bold">
              {{ typeLabel(component.type) }}
            </p>
            <h2 class="mt-1 truncate text-base font-bold text-gray-900">
              {{ component.label || 'Field settings' }}
            </h2>
          </div>
          <button
            type="button"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-600"
            aria-label="Delete component"
            [disabled]="disabled"
            (click)="removed.emit()"
          >
            <ion-icon name="trash-outline"></ion-icon>
          </button>
        </div>
        <!-- Pestañas fuera del fieldset: en solo lectura se navegan; solo se bloquea la edición. -->
        <!-- Con 4 pestañas van en 2 filas: a 17rem no entran sin cortarse. -->
        <app-segmented
          class="mt-4"
          [fill]="tabOptions().length <= 3"
          [columns]="tabOptions().length > 3 ? 2 : null"
          [options]="tabOptions()"
          [value]="activeTab()"
          [controls]="'inspector-panel-' + component.id"
          ariaLabel="Field settings sections"
          (valueChange)="tab.set($event)"
        />
      }
      <!-- Solo lectura: fieldset deshabilita los controles nativos e inert cubre el editor de texto. -->
      <fieldset
        class="m-0 min-w-0 border-0 p-0"
        [disabled]="disabled"
        [attr.inert]="disabled ? '' : null"
        [attr.aria-disabled]="disabled"
        [attr.id]="component ? 'inspector-panel-' + component.id : null"
        [attr.role]="component ? 'tabpanel' : null"
        data-builder-inspector
      >
      @if (component) {
        @switch (activeTab()) {
        @case ('mapping') {
          <div class="mt-5">
            @if (definition) {
              <!-- Diferido: el editor de mapeo baja solo al abrir la pestaña. -->
              @defer {
              <app-field-mapping-editor
                [definition]="definition"
                [componentId]="component.id"
                [catalog]="mappingCatalog"
                [loading]="mappingLoading"
                [error]="mappingError"
                [disabled]="disabled"
                (mappingChange)="mappingChange.emit($event)"
                (componentPatch)="patch($event)"
                (retry)="mappingRetry.emit()"
              />
              } @placeholder {
                <p class="text-xs text-gray-500">Loading…</p>
              }
            }
          </div>
        }
        @case ('display') {
          <div class="mt-5 space-y-4">
            <div>
              <span class="text-xs font-semibold text-gray-600">Width</span
              ><app-segmented
                class="mt-1"
                [columns]="2"
                [options]="widthOptions"
                [value]="component.style?.width || 'full'"
                (valueChange)="style('width', $event)"
              />
            </div>
            <div>
              <span class="text-xs font-semibold text-gray-600">Text size</span
              ><app-segmented
                class="mt-1"
                [columns]="3"
                [options]="textSizeOptions"
                [value]="component.style?.textSize || 'body'"
                (valueChange)="style('textSize', $event)"
              />
            </div>
            <div>
              <span class="text-xs font-semibold text-gray-600">Alignment</span
              ><app-segmented
                class="mt-1"
                [fill]="true"
                [options]="alignmentOptions"
                [value]="component.style?.align || 'left'"
                (valueChange)="style('align', $event)"
              />
            </div>
            <label class="block text-xs font-semibold text-gray-600"
              >Text color
              <app-form-select-control
                class="mt-1 block"
                [value]="component.style?.textColor || 'ink'"
                [options]="textColorOptions"
                [placeholder]="''"
                (valueChange)="style('textColor', $event)"
              />
            </label>
          </div>
        }
        @case ('logic') {
          <div class="mt-5">
            <app-condition-editor
              [condition]="component.visibleWhen || null"
              [fields]="earlierFields"
              (conditionChange)="conditionChanged($event)"
            />
          </div>
        }
        @default {
        <div class="mt-5 space-y-4">
          @if (hasRichText()) {
            <span
              [id]="'inspector-content-label-' + component.id"
              class="block text-xs font-semibold text-gray-600"
              >Content</span
            >
            <app-rich-text-editor
              [ariaLabelledby]="'inspector-content-label-' + component.id"
              [document]="richText()"
              (documentChange)="richTextChanged($event)"
            />
          }
          @if (component.type === 'heading') {
            <label class="block text-xs font-semibold text-gray-600"
              >Heading<app-form-text-control
                class="mt-1 block"
                [maxLength]="200"
                [value]="propertyText('text', 'Section heading')"
                (valueChange)="setProperty('text', $event)"
            /></label>
            <div>
              <span class="text-xs font-semibold text-gray-600">Level</span
              ><app-segmented
                class="mt-1"
                [fill]="true"
                [options]="headingLevelOptions"
                [value]="propertyText('level', '2')"
                (valueChange)="setProperty('level', Number($event))"
              />
            </div>
          }
          @if (component.type === 'callout') {
            <label class="block text-xs font-semibold text-gray-600"
              >Title<app-form-text-control
                class="mt-1 block"
                [maxLength]="120"
                [value]="propertyText('title')"
                (valueChange)="setProperty('title', $event)"
            /></label>
            <label class="block text-xs font-semibold text-gray-600"
              >Tone<app-form-select-control
                class="mt-1 block"
                [value]="propertyText('tone', 'info')"
                [options]="calloutToneOptions"
                [placeholder]="''"
                (valueChange)="setProperty('tone', $event)"
            /></label>
          }
          @if (isInput()) {
            <label class="block text-xs font-semibold text-gray-600"
              >Label
              <app-form-text-control
                class="mt-1 block"
                [value]="component.label || ''"
                (valueChange)="patch({ label: $event })"
              />
            </label>
            @if (sensitiveLabel()) {
              <p class="rounded-xl border-l-2 border-amber-500 bg-amber-50 p-2 text-xs text-amber-800">
                {{ sensitiveLabel() }}
              </p>
            }
            <app-form-checkbox-control
              [checked]="component.required === true"
              (checkedChange)="patch({ required: $event })"
              >Required</app-form-checkbox-control
            >
            <label class="block text-xs font-semibold text-gray-600"
              >Data classification
              <app-form-select-control
                class="mt-1 block"
                [value]="component.dataClass || minimumClass()"
                [options]="dataClassOptions()"
                [placeholder]="''"
                (valueChange)="dataClassChanged($event)"
              />
            </label>
            <app-form-checkbox-control
              [disabled]="
                component.dataClass === 'personal' || component.dataClass === 'restricted'
              "
              [checked]="component.reportable === true"
              (checkedChange)="reportableChanged($event)"
              >Reportable</app-form-checkbox-control
            >
          }

          @if (hasOptions()) {
            <!-- Valores estables: el optionMap, las condiciones y las respuestas apuntan al valor. -->
            <app-option-list-editor
              [options]="options()"
              [componentId]="component.id"
              [fieldLabel]="component.label || 'this field'"
              [definition]="definition"
              [canEditMapping]="mappingAllowed()"
              (optionsChange)="optionsChanged($event)"
              (optionMapCleared)="clearOptionMap($event)"
            />
          }

          @if (component.type === 'text') {
            <div class="grid grid-cols-2 gap-3">
              <label class="text-xs font-semibold text-gray-600"
                >Minimum length<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  min="0"
                  max="1000"
                  [value]="propertyText('minLength', '0')"
                  (valueChange)="setNumberProperty('minLength', $event)"
              /></label>
              <label class="text-xs font-semibold text-gray-600"
                >Maximum length<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  min="1"
                  max="1000"
                  [value]="propertyText('maxLength', '200')"
                  (valueChange)="setNumberProperty('maxLength', $event)"
              /></label>
            </div>
          }
          @if (component.type === 'textarea') {
            <div class="grid grid-cols-2 gap-3">
              <label class="text-xs font-semibold text-gray-600"
                >Rows<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  min="2"
                  max="12"
                  [value]="propertyText('rows', '4')"
                  (valueChange)="setNumberProperty('rows', $event)"
              /></label>
              <label class="text-xs font-semibold text-gray-600"
                >Maximum length<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  min="1"
                  max="10000"
                  [value]="propertyText('maxLength', '2000')"
                  (valueChange)="setNumberProperty('maxLength', $event)"
              /></label>
            </div>
          }
          @if (component.type === 'number') {
            <div class="grid grid-cols-2 gap-3">
              <label class="text-xs font-semibold text-gray-600"
                >Minimum<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  [value]="propertyText('min')"
                  (valueChange)="setOptionalNumberProperty('min', $event)"
              /></label>
              <label class="text-xs font-semibold text-gray-600"
                >Maximum<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  [value]="propertyText('max')"
                  (valueChange)="setOptionalNumberProperty('max', $event)"
              /></label>
              <label class="text-xs font-semibold text-gray-600"
                >Decimals<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  min="0"
                  max="6"
                  [value]="propertyText('decimals', '0')"
                  (valueChange)="setNumberProperty('decimals', $event)"
              /></label>
              <label class="text-xs font-semibold text-gray-600"
                >Unit label<app-form-text-control
                  class="mt-1 block"
                  [maxLength]="20"
                  [value]="propertyText('unitLabel')"
                  (valueChange)="setProperty('unitLabel', $event)"
              /></label>
            </div>
          }
          @if (component.type === 'currency') {
            <div class="grid grid-cols-2 gap-3">
              <label class="text-xs font-semibold text-gray-600"
                >Minimum<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  [value]="propertyText('min', '0')"
                  (valueChange)="setNumberProperty('min', $event)"
              /></label>
              <label class="text-xs font-semibold text-gray-600"
                >Maximum<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  [value]="propertyText('max')"
                  (valueChange)="setOptionalNumberProperty('max', $event)"
              /></label>
            </div>
            <app-form-checkbox-control
              [checked]="propertyBoolean('allowNegative')"
              (checkedChange)="setProperty('allowNegative', $event)"
              >Allow negative values</app-form-checkbox-control
            >
          }
          @if (component.type === 'date') {
            <div class="grid grid-cols-2 gap-3">
              @for (bound of dateBounds; track bound.key) {
                <div>
                  <label class="block text-xs font-semibold text-gray-600"
                    >{{ bound.label }}
                    @if (propertyText(bound.key) === 'today') {
                      <span class="mt-1 flex min-h-11 items-center rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm font-normal text-gray-900">
                        Today
                      </span>
                    } @else {
                      <app-form-text-control
                        class="mt-1 block"
                        type="date"
                        [value]="propertyText(bound.key)"
                        (valueChange)="setProperty(bound.key, $event || undefined)"
                      />
                    }
                  </label>
                  <!-- "today" es relativo al día del envío (lo exige un destino pastOnly). -->
                  <app-form-checkbox-control
                    class="mt-1 block"
                    [checked]="propertyText(bound.key) === 'today'"
                    (checkedChange)="setProperty(bound.key, $event ? 'today' : undefined)"
                    >{{ bound.label }} is today</app-form-checkbox-control
                  >
                </div>
              }
            </div>
          }
          @if (component.type === 'radio') {
            <div>
              <span class="text-xs font-semibold text-gray-600">Option layout</span
              ><app-segmented
                class="mt-1"
                [fill]="true"
                [options]="radioLayoutOptions"
                [value]="propertyText('layout', 'vertical')"
                (valueChange)="setProperty('layout', $event)"
              />
            </div>
          }
          @if (component.type === 'checkboxGroup') {
            <div class="grid grid-cols-2 gap-3">
              <label class="text-xs font-semibold text-gray-600"
                >Minimum choices<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  min="0"
                  [value]="propertyText('minSelected', '0')"
                  (valueChange)="setNumberProperty('minSelected', $event)"
              /></label>
              <label class="text-xs font-semibold text-gray-600"
                >Maximum choices<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  min="0"
                  [value]="propertyText('maxSelected', optionCountText())"
                  (valueChange)="setNumberProperty('maxSelected', $event)"
              /></label>
            </div>
          }
          @if (component.type === 'yesNo') {
            <div class="grid grid-cols-2 gap-3">
              <label class="text-xs font-semibold text-gray-600"
                >Yes label<app-form-text-control
                  class="mt-1 block"
                  [maxLength]="30"
                  [value]="propertyText('yesLabel', 'Yes')"
                  (valueChange)="setProperty('yesLabel', $event)"
              /></label>
              <label class="text-xs font-semibold text-gray-600"
                >No label<app-form-text-control
                  class="mt-1 block"
                  [maxLength]="30"
                  [value]="propertyText('noLabel', 'No')"
                  (valueChange)="setProperty('noLabel', $event)"
              /></label>
            </div>
          }
          @if (component.type === 'file') {
            <div class="grid grid-cols-2 gap-3">
              <label class="text-xs font-semibold text-gray-600"
                >Maximum files<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  min="1"
                  max="20"
                  [value]="propertyText('maxFiles', '1')"
                  (valueChange)="setNumberProperty('maxFiles', $event)"
              /></label>
              <label class="text-xs font-semibold text-gray-600"
                >Maximum MB<app-form-text-control
                  class="mt-1 block"
                  type="number"
                  min="1"
                  max="25"
                  [value]="maxFileMegabytes()"
                  (valueChange)="setFileMegabytes($event)"
              /></label>
            </div>
            <fieldset>
              <legend class="text-xs font-semibold text-gray-600">Allowed file types</legend>
              <div class="mt-2 grid grid-cols-2 gap-2">
                @for (type of fileTypes; track type) {
                  <app-form-checkbox-control
                    [checked]="arrayPropertyIncludes('allowedTypes', type)"
                    (checkedChange)="toggleArrayProperty('allowedTypes', type, $event)"
                    >{{ type.toUpperCase() }}</app-form-checkbox-control
                  >
                }
              </div>
            </fieldset>
          }
          @if (component.type === 'taxId') {
            <fieldset>
              <legend class="text-xs font-semibold text-gray-600">Accepted identifiers</legend>
              <div class="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                @for (kind of taxIdKinds; track kind) {
                  <app-form-checkbox-control
                    [checked]="arrayPropertyIncludes('kinds', kind)"
                    (checkedChange)="toggleArrayProperty('kinds', kind, $event)"
                    >{{ kind.toUpperCase() }}</app-form-checkbox-control
                  >
                }
              </div>
            </fieldset>
          }
          @if (component.type === 'spacer') {
            <label class="block text-xs font-semibold text-gray-600"
              >Space<app-form-select-control
                class="mt-1 block"
                [value]="propertyText('size', '4')"
                [options]="spacingOptions"
                [placeholder]="''"
                (valueChange)="setProperty('size', $event)"
            /></label>
          }
          @if (component.type === 'signatureStep') {
            <label class="block text-xs font-semibold text-gray-600"
              >Verification<app-form-select-control
                class="mt-1 block"
                [value]="propertyText('verification', 'emailOtp')"
                [options]="signatureVerificationOptions"
                [placeholder]="''"
                (valueChange)="setProperty('verification', $event)"
            /></label>
          }
          @if (component.type === 'consent') {
            <label class="block text-xs font-semibold text-gray-600"
              >Notice key<app-form-text-control
                class="mt-1 block"
                [maxLength]="120"
                [value]="propertyText('noticeKey', 'privacy')"
                (valueChange)="setProperty('noticeKey', $event)"
            /></label>
            <label class="block text-xs font-semibold text-gray-600"
              >Notice version<app-form-text-control
                class="mt-1 block"
                type="number"
                min="1"
                [value]="propertyText('noticeVersionNumber', '1')"
                (valueChange)="setNumberProperty('noticeVersionNumber', $event)"
            /></label>
            <label class="block text-xs font-semibold text-gray-600"
              >Mode<app-form-select-control
                class="mt-1 block"
                [value]="propertyText('mode', 'noticeOnly')"
                [options]="consentModeOptions"
                [placeholder]="''"
                (valueChange)="consentModeChanged($event)"
            /></label>
            @if (propertyText('mode', 'noticeOnly') === 'acceptance') {
              <label class="block text-xs font-semibold text-gray-600"
                >Timing<app-form-select-control
                  class="mt-1 block"
                  [value]="propertyText('timing', 'beforeSubmit')"
                  [options]="consentTimingOptions"
                  [placeholder]="''"
                  (valueChange)="setProperty('timing', $event)"
              /></label>
              <label class="block text-xs font-semibold text-gray-600"
                >Acceptance text<app-form-text-control
                  class="mt-1 block"
                  [maxLength]="300"
                  [value]="propertyText('acceptanceText', 'I agree')"
                  (valueChange)="setProperty('acceptanceText', $event)"
              /></label>
              <app-form-checkbox-control
                [checked]="propertyBoolean('blocking')"
                (checkedChange)="setProperty('blocking', $event)"
                >Block progress until accepted</app-form-checkbox-control
              >
            }
          }

          <button
            type="button"
            class="w-full rounded-full border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            (click)="duplicated.emit()"
          >
            Duplicate field
          </button>
        </div>
        }
        }
      } @else {
        <div class="flex min-h-48 items-center justify-center text-center">
          <p class="max-w-48 text-sm text-gray-500">Select a field to edit its settings.</p>
        </div>
      }
      </fieldset>
    </aside>
  `,
})
export class ComponentInspectorComponent {
  @Input() set component(value: FormComponent | null) {
    this.current.set(value);
  }
  get component(): FormComponent | null {
    return this.current();
  }
  /** Otra pestaña tiene el control o hay un conflicto: no se acepta ninguna edición. */
  @Input() disabled = false;
  @Input() earlierFields: FormComponent[] = [];
  @Output() readonly componentChange = new EventEmitter<Partial<FormComponent>>();
  @Output() readonly removed = new EventEmitter<void>();
  @Output() readonly duplicated = new EventEmitter<void>();
  /** Muestra la pestaña "Mapping": quien la usa decide con `tasks.form_templates.configure_actions`. */
  @Input() set canMap(value: boolean) {
    this.mappingAllowed.set(value);
  }
  /** Definición completa: el mapeo vive en `definition.mappings`, no en el componente. */
  /** Abre una pestaña a pedido del builder (p. ej. "Mapping" desde la cobertura); null no cambia nada. */
  @Input() set preferredTab(value: InspectorTab | null) {
    if (value) this.tab.set(value);
  }
  @Input() definition: FormDefinition | null = null;
  @Input() mappingCatalog: MappingCatalog | null = null;
  @Input() mappingLoading = false;
  @Input() mappingError = '';
  @Output() readonly mappingChange = new EventEmitter<FormMapping | null>();
  @Output() readonly mappingRetry = new EventEmitter<void>();
  readonly Number = Number;

  private readonly current = signal<FormComponent | null>(null);
  protected readonly mappingAllowed = signal(false);
  private readonly mappable = computed(() => {
    const component = this.current();
    return this.mappingAllowed() && component != null && getComponentType(component.type)?.kind === 'input';
  });
  /** Pestaña activa; se conserva al cambiar de campo. */
  readonly tab = signal<InspectorTab>('settings');
  readonly tabOptions = computed<readonly SegmentedOption<InspectorTab>[]>(() => [
    { id: 'settings', label: 'Settings' },
    { id: 'display', label: 'Display' },
    { id: 'logic', label: 'Logic' },
    ...(this.mappable() ? [{ id: 'mapping' as const, label: 'Mapping' }] : []),
  ]);

  /** "Mapping" no aplica a layout ni sin permiso: vuelve a Settings sin perder la elección. */
  readonly activeTab = computed<InspectorTab>(() =>
    this.tab() === 'mapping' && !this.mappable() ? 'settings' : this.tab(),
  );
  readonly widthOptions: readonly SegmentedOption[] = [
    { id: 'full', label: 'Full' },
    { id: 'half', label: 'Half' },
    { id: 'third', label: 'Third' },
    { id: 'twoThirds', label: 'Two thirds' },
  ];
  readonly textSizeOptions: readonly SegmentedOption[] = [
    { id: 'caption', label: 'Caption' },
    { id: 'ui', label: 'UI' },
    { id: 'body', label: 'Body' },
    { id: 'h3', label: 'H3' },
    { id: 'h2', label: 'H2' },
    { id: 'h1', label: 'H1' },
  ];
  readonly alignmentOptions: readonly SegmentedOption[] = ['left', 'center', 'right'].map((id) => ({
    id,
    label: this.label(id),
  }));
  readonly radioLayoutOptions: readonly SegmentedOption[] = ['vertical', 'horizontal'].map(
    (id) => ({ id, label: this.label(id) }),
  );
  readonly headingLevelOptions: readonly SegmentedOption[] = [
    { id: '2', label: 'H2' },
    { id: '3', label: 'H3' },
  ];
  readonly textColorOptions: readonly FormControlOption[] = [
    'ink',
    'secondary',
    'muted',
    'brand',
    'accent',
    'success',
    'warning',
    'danger',
    'info',
  ].map((value) => ({ value, label: this.label(value) }));
  readonly spacingOptions: readonly FormControlOption[] = ['2', '4', '6', '8'].map((value) => ({
    value,
    label: value,
  }));
  readonly signatureVerificationOptions: readonly FormControlOption[] = [
    { value: 'emailOtp', label: 'Email OTP' },
    { value: 'smsOtp', label: 'SMS OTP' },
  ];
  readonly calloutToneOptions: readonly FormControlOption[] = ['info', 'warning', 'success'].map(
    (value) => ({ value, label: this.label(value) }),
  );
  readonly consentModeOptions: readonly FormControlOption[] = [
    { value: 'noticeOnly', label: 'Notice only' },
    { value: 'acceptance', label: 'Acceptance' },
  ];
  readonly consentTimingOptions: readonly FormControlOption[] = [
    { value: 'beforeCollection', label: 'Before collection' },
    { value: 'beforeSubmit', label: 'Before submit' },
  ];
  readonly fileTypes = ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx', 'csv', 'txt'] as const;
  readonly taxIdKinds = ['ssn', 'itin', 'ein'] as const;

  isInput(): boolean {
    return this.component ? getComponentType(this.component.type)?.kind === 'input' : false;
  }
  minimumClass(): string {
    return this.component
      ? (getComponentType(this.component.type)?.minimumDataClass ?? 'general')
      : 'general';
  }
  allowedClasses(): readonly string[] {
    const index = DATA_CLASSES.indexOf(this.minimumClass() as (typeof DATA_CLASSES)[number]);
    return DATA_CLASSES.slice(Math.max(0, index));
  }
  dataClassOptions(): readonly FormControlOption[] {
    return this.allowedClasses().map((value) => ({ value, label: this.label(value) }));
  }
  hasOptions(): boolean {
    return !!this.component && ['select', 'radio', 'checkboxGroup'].includes(this.component.type);
  }
  hasRichText(): boolean {
    return !!this.component && ['paragraph', 'callout', 'checkbox'].includes(this.component.type);
  }
  richText(): RichTextDocument | null {
    const value = this.component?.props?.['text'];
    return typeof value === 'object' && value != null && !Array.isArray(value)
      ? (value as RichTextDocument)
      : null;
  }
  richTextChanged(document: RichTextDocument): void {
    this.patch({ props: { ...(this.component?.props ?? {}), text: document } });
  }
  sensitiveLabel(): string {
    const label = this.component?.label?.toLowerCase() ?? '';
    if (/ssn|ein|tax id/.test(label) && this.component?.type !== 'taxId')
      return 'Use the dedicated Tax ID field for tax identifiers.';
    if (/bank account|routing|card/.test(label))
      return 'Bank and payment card details cannot be collected in forms.';
    return '';
  }
  patch(update: Partial<FormComponent>): void {
    this.componentChange.emit(update);
  }
  typeLabel(type: string): string {
    return componentTypeLabel(type);
  }
  label(value: string): string {
    return value.replace(/([A-Z])/g, ' $1').replace(/^./, (item) => item.toUpperCase());
  }
  dataClassChanged(value: string): void {
    this.patch({
      dataClass: value as FormComponent['dataClass'],
      ...(['personal', 'restricted'].includes(value) ? { reportable: false } : {}),
    });
  }
  // Reportable exige un key único; si el campo no tiene, se deriva del id (válido y único). El CRM y el
  // CSV muestran el Label, así que el key no necesita ser legible.
  reportableChanged(reportable: boolean): void {
    const component = this.component;
    const needsKey = reportable && component != null && !component.key;
    this.patch({ reportable, ...(needsKey ? { key: component!.id } : {}) });
  }
  style(key: keyof FormStyle, value: string): void {
    this.patch({ style: { ...(this.component?.style ?? {}), [key]: value } });
  }
  conditionChanged(condition: Condition | null): void {
    this.patch({ visibleWhen: condition });
  }
  readonly dateBounds = [
    { key: 'min', label: 'Earliest date' },
    { key: 'max', label: 'Latest date' },
  ] as const;
  options(): ComponentOption[] {
    return this.component ? componentOptions(this.component) : [];
  }
  /** Conserva el `value` de cada opción; solo cambian etiquetas, orden y altas/bajas. */
  optionsChanged(options: ComponentOption[]): void {
    this.patch({ props: { ...(this.component?.props ?? {}), options } });
  }
  /** Quita del optionMap la opción borrada (solo llega con permiso de mapeo). */
  clearOptionMap(value: string): void {
    const id = this.component?.id;
    const mapping = id && this.definition ? mappingFor(this.definition, id) : null;
    if (!mapping?.optionMap || !(value in mapping.optionMap)) return;
    const optionMap = { ...mapping.optionMap };
    delete optionMap[value];
    this.mappingChange.emit({ ...mapping, optionMap });
  }
  propertyText(name: string, fallback = ''): string {
    const value = this.component?.props?.[name];
    return value == null ? fallback : String(value);
  }
  propertyBoolean(name: string): boolean {
    return this.component?.props?.[name] === true;
  }
  setProperty(name: string, value: unknown): void {
    this.patch({ props: { ...(this.component?.props ?? {}), [name]: value } });
  }
  setNumberProperty(name: string, value: string): void {
    const number = Number(value);
    if (Number.isFinite(number)) this.setProperty(name, number);
  }
  setOptionalNumberProperty(name: string, value: string): void {
    this.setProperty(name, value === '' ? undefined : Number(value));
  }
  arrayPropertyIncludes(name: string, value: string): boolean {
    const values = this.component?.props?.[name];
    return Array.isArray(values) && values.includes(value);
  }
  toggleArrayProperty(name: string, value: string, checked: boolean): void {
    const current = this.component?.props?.[name];
    const values = Array.isArray(current) ? current.filter((item) => typeof item === 'string') : [];
    this.setProperty(
      name,
      checked ? [...new Set([...values, value])] : values.filter((item) => item !== value),
    );
  }
  optionCountText(): string {
    const options = this.component?.props?.['options'];
    return String(Array.isArray(options) ? options.length : 0);
  }
  maxFileMegabytes(): string {
    const value = this.component?.props?.['maxFileBytes'];
    return String(
      Math.max(1, Math.round((typeof value === 'number' ? value : 10_485_760) / 1_048_576)),
    );
  }
  setFileMegabytes(value: string): void {
    const megabytes = Number(value);
    if (Number.isFinite(megabytes))
      this.setProperty('maxFileBytes', Math.round(megabytes * 1_048_576));
  }
  consentModeChanged(mode: string): void {
    const props: Record<string, unknown> = { ...(this.component?.props ?? {}), mode };
    if (mode === 'acceptance') {
      props['timing'] ??= 'beforeSubmit';
      props['acceptanceText'] ??= 'I agree';
      props['blocking'] ??= false;
    } else {
      delete props['timing'];
      delete props['acceptanceText'];
      props['blocking'] = false;
    }
    this.patch({ props });
  }
}
