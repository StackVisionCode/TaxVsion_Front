import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import {
  FormSelectControlComponent,
  type FormControlOption,
} from '@shared/ui/form-controls/form-select-control.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import type { FormDefinition, FormMapping } from '@shared/utils/data-collection/form-definition.model';
import type { MappingCatalog } from '../../data-access/mapping-catalog.model';
import { operationLabel } from '../../utils/form-action-catalog';
import {
  collectionTargets,
  componentLabel,
  domainsOf,
  entitiesOf,
  humanizeFieldName,
  limitLabels,
  missingRowFields,
  requirementLabels,
  rowFieldCandidates,
  rowFieldWarnings,
  suggestRowFields,
} from '../../utils/mapping-compatibility';
import { mappingFor } from '../../utils/mapping-mutations';

/**
 * Mapeo de una sección repeater a un destino de colección (p. ej. dependientes): Domain → Entity →
 * Property y, por cada campo de fila, el componente del repeater que lo alimenta (`rowFields`).
 * Presentacional, mismo contrato que el editor de campo: emite el mapeo nuevo o null.
 */
@Component({
  selector: 'app-repeater-mapping-editor',
  imports: [FormSelectControlComponent, StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4" [attr.aria-labelledby]="ids().title">
      <div>
        <h3 [id]="ids().title" class="text-sm font-bold text-gray-900">Data mapping</h3>
        <p class="mt-1 text-xs text-gray-500">Send each row to a list in the client record.</p>
      </div>

      @if (loading()) {
        <p class="text-xs text-gray-500" role="status">Loading client properties…</p>
      } @else if (error()) {
        <div class="rounded-2xl border border-red-200 bg-red-50 px-3 py-3" role="alert">
          <p class="text-xs font-semibold text-red-800">{{ error() }}</p>
          <button
            type="button"
            class="mt-2 rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-800 hover:bg-red-100"
            (click)="retry.emit()"
          >
            Try again
          </button>
        </div>
      } @else if (catalog() && section()) {
        @if (mapping() && !target()) {
          <!-- Destino ausente del catálogo: el mapeo siempre se puede quitar. -->
          <div class="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900" role="alert" data-testid="repeater-mapping-orphan">
            <p>This section is mapped to “{{ mapping()!.targetKey }}”, which isn't available to you.</p>
            <button
              type="button"
              class="mt-2 rounded-full border border-amber-300 bg-white px-3 py-1.5 font-semibold hover:bg-amber-100 disabled:opacity-50"
              [disabled]="disabled()"
              (click)="mappingChange.emit(null)"
            >
              Remove mapping
            </button>
          </div>
        } @else if (targets().length === 0) {
          <p class="rounded-2xl bg-gray-50 px-3 py-3 text-xs text-gray-600" data-testid="repeater-mapping-unavailable">
            No client list you can use accepts repeating sections.
          </p>
        } @else {
          <div class="space-y-3">
            <div>
              <label [for]="ids().domain" class="mb-1 block text-xs font-semibold text-gray-600">Domain</label>
              <app-form-select-control
                [id]="ids().domain"
                [value]="domain()"
                [options]="domainOptions()"
                placeholder=""
                [disabled]="disabled()"
                (valueChange)="domain.set($event)"
              />
            </div>
            <div>
              <label [for]="ids().entity" class="mb-1 block text-xs font-semibold text-gray-600">Entity</label>
              <app-form-select-control
                [id]="ids().entity"
                [value]="entity()"
                [options]="entityOptions()"
                placeholder=""
                [disabled]="disabled()"
                (valueChange)="entity.set($event)"
              />
            </div>
            <div>
              <label [for]="ids().property" class="mb-1 block text-xs font-semibold text-gray-600">Client list</label>
              <app-form-select-control
                [id]="ids().property"
                [value]="mapping()?.targetKey ?? ''"
                [options]="propertyOptions()"
                placeholder="Not mapped"
                [disabled]="disabled()"
                (valueChange)="selectTarget($event)"
              />
            </div>
          </div>

          @if (target(); as current) {
            <div class="flex flex-wrap gap-1.5" data-testid="repeater-mapping-badges">
              @for (label of requirements(); track label) {
                <app-status-pill tone="brand" [soft]="true" [dot]="false" size="xs">Required for: {{ label }}</app-status-pill>
              }
              @for (label of operations(); track label) {
                <app-status-pill tone="info" [soft]="true" [dot]="false" size="xs">Used by: {{ label }}</app-status-pill>
              }
              @for (label of limits(); track label) {
                <app-status-pill tone="neutral" [soft]="true" [dot]="false" size="xs">{{ label }}</app-status-pill>
              }
            </div>

            <fieldset class="rounded-2xl border border-gray-200 px-3 py-3" data-testid="row-fields">
              <legend class="px-1 text-xs font-semibold text-gray-700">Row fields</legend>
              <div class="space-y-2">
                @for (field of current.fields; track field.name; let index = $index) {
                  <div class="grid grid-cols-2 items-center gap-2">
                    <label [for]="ids().row + index" class="truncate text-xs text-gray-700">
                      {{ fieldLabel(field.name) }}@if (field.required) {<span class="text-red-600" aria-hidden="true"> *</span><span class="sr-only"> (required)</span>}
                    </label>
                    <app-form-select-control
                      [id]="ids().row + index"
                      [value]="assigned()[field.name] ?? ''"
                      [options]="rowOptions(field.name)"
                      placeholder="Not mapped"
                      [disabled]="disabled()"
                      [invalid]="field.required === true && !assigned()[field.name]"
                      (valueChange)="setRowField(field.name, $event)"
                    />
                  </div>
                }
              </div>
              <div class="mt-3 flex items-center justify-between gap-2">
                <p class="text-xs" [class]="missing().length === 0 ? 'text-emerald-700' : 'text-amber-800'" role="status">
                  @if (missing().length === 0) {
                    All required row fields are mapped.
                  } @else {
                    Still needed: {{ missingLabels() }}.
                  }
                </p>
                <button
                  type="button"
                  class="shrink-0 rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  [disabled]="disabled()"
                  (click)="autoMatch()"
                >
                  Auto-match
                </button>
              </div>
            </fieldset>

            @if (warnings().length > 0) {
              <ul class="space-y-1 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="repeater-mapping-warnings">
                @for (warning of warnings(); track warning) {
                  <li>{{ warning }}</li>
                }
              </ul>
            }

            <button
              type="button"
              class="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              [disabled]="disabled()"
              (click)="mappingChange.emit(null)"
            >
              Remove mapping
            </button>
          }
        }
      }
    </section>
  `,
})
export class RepeaterMappingEditorComponent {
  readonly definition = input.required<FormDefinition>();
  readonly sectionId = input.required<string>();
  readonly catalog = input<MappingCatalog | null>(null);
  readonly loading = input(false);
  readonly error = input('');
  readonly disabled = input(false);

  /** El mapeo nuevo de la sección; null lo quita. */
  readonly mappingChange = output<FormMapping | null>();
  readonly retry = output<void>();

  protected readonly ids = computed(() => {
    const id = this.sectionId();
    return {
      title: `repeater-mapping-title-${id}`,
      domain: `repeater-mapping-domain-${id}`,
      entity: `repeater-mapping-entity-${id}`,
      property: `repeater-mapping-property-${id}`,
      row: `repeater-mapping-row-${id}-`,
    };
  });

  protected readonly section = computed(
    () =>
      this.definition()
        .pages.flatMap((page) => page.sections)
        .find((item) => item.id === this.sectionId() && item.repeat != null) ?? null,
  );
  protected readonly mapping = computed(() => mappingFor(this.definition(), this.sectionId()));

  protected readonly targets = computed(() => {
    const catalog = this.catalog();
    return catalog ? collectionTargets(catalog, this.mapping()?.targetKey ?? null) : [];
  });

  protected readonly target = computed(() => {
    const key = this.mapping()?.targetKey;
    return key ? (this.catalog()?.targets.find((item) => item.targetKey === key) ?? null) : null;
  });

  protected readonly domain = linkedSignal(() => this.target()?.domain ?? domainsOf(this.targets())[0] ?? '');
  protected readonly entity = linkedSignal(() => {
    const current = this.target();
    if (current && current.domain === this.domain()) return current.entity;
    return entitiesOf(this.targets(), this.domain())[0] ?? '';
  });

  protected readonly domainOptions = computed<FormControlOption[]>(() =>
    domainsOf(this.targets()).map((value) => ({ value, label: value })),
  );
  protected readonly entityOptions = computed<FormControlOption[]>(() =>
    entitiesOf(this.targets(), this.domain()).map((value) => ({ value, label: value })),
  );

  private readonly takenTargets = computed(() => {
    const own = this.sectionId();
    return new Set(
      (this.definition().mappings ?? []).filter((item) => item.componentId !== own).map((item) => item.targetKey),
    );
  });

  protected readonly propertyOptions = computed<FormControlOption[]>(() =>
    this.targets()
      .filter(
        (target) =>
          target.domain === this.domain() &&
          target.entity === this.entity() &&
          !this.takenTargets().has(target.targetKey),
      )
      .map((target) => ({ value: target.targetKey, label: target.displayName })),
  );

  protected readonly requirements = computed(() => {
    const target = this.target();
    return target ? requirementLabels(target) : [];
  });
  protected readonly operations = computed(() => (this.target()?.operations ?? []).map(operationLabel));
  protected readonly limits = computed(() => {
    const target = this.target();
    return target ? limitLabels(target) : [];
  });

  /** Campo de fila → componente asignado. */
  protected readonly assigned = computed<Partial<Record<string, string>>>(() => {
    const result: Partial<Record<string, string>> = {};
    for (const [componentId, fieldName] of Object.entries(this.mapping()?.rowFields ?? {}))
      result[fieldName] ??= componentId;
    return result;
  });

  protected readonly missing = computed(() => {
    const target = this.target();
    return target ? missingRowFields(target, this.mapping()?.rowFields) : [];
  });
  protected readonly missingLabels = computed(() => this.missing().map(humanizeFieldName).join(', '));

  protected readonly warnings = computed(() => {
    const target = this.target();
    const section = this.section();
    return target && section ? rowFieldWarnings(section, target, this.mapping()?.rowFields) : [];
  });

  protected fieldLabel(name: string): string {
    return humanizeFieldName(name);
  }

  /** Candidatos del campo, sin los que ya alimentan otro campo de fila. */
  protected rowOptions(fieldName: string): FormControlOption[] {
    const target = this.target();
    const section = this.section();
    if (!target || !section) return [];
    const rowFields = this.mapping()?.rowFields ?? {};
    return rowFieldCandidates(this.definition(), section, target, fieldName)
      .filter((component) => rowFields[component.id] == null || rowFields[component.id] === fieldName)
      .map((component) => ({ value: component.id, label: componentLabel(component) }));
  }

  protected selectTarget(targetKey: string): void {
    if (!targetKey) {
      this.mappingChange.emit(null);
      return;
    }
    const section = this.section();
    const target = this.catalog()?.targets.find((item) => item.targetKey === targetKey);
    if (!section || !target || targetKey === this.mapping()?.targetKey) return;
    this.mappingChange.emit({
      componentId: section.id,
      targetKey,
      rowFields: suggestRowFields(this.definition(), section, target, null),
    });
  }

  protected setRowField(fieldName: string, componentId: string): void {
    const mapping = this.mapping();
    if (!mapping) return;
    const rowFields: Record<string, string> = {};
    for (const [id, name] of Object.entries(mapping.rowFields ?? {}))
      if (name !== fieldName && id !== componentId) rowFields[id] = name;
    if (componentId) rowFields[componentId] = fieldName;
    this.mappingChange.emit({ ...mapping, rowFields });
  }

  protected autoMatch(): void {
    const mapping = this.mapping();
    const section = this.section();
    const target = this.target();
    if (!mapping || !section || !target) return;
    this.mappingChange.emit({
      ...mapping,
      rowFields: suggestRowFields(this.definition(), section, target, mapping.rowFields),
    });
  }
}
