import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import {
  FormSelectControlComponent,
  type FormControlOption,
} from '@shared/ui/form-controls/form-select-control.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import type {
  FormComponent,
  FormDefinition,
  FormMapping,
  MappingTransform,
} from '@shared/utils/data-collection/form-definition.model';
import type { MappingCatalog } from '../../data-access/mapping-catalog.model';
import {
  TRANSFORM_LABELS,
  allowedTransforms,
  compatibleTargets,
  componentOptions,
  createMapping,
  domainsOf,
  entitiesOf,
  findComponentContext,
  isOptionMapComplete,
  limitLabels,
  mappingUnavailableReason,
  isTargetCompatible,
  mappingWarnings,
  requirementLabels,
  type MappingWarning,
  suggestOptionMap,
} from '../../utils/mapping-compatibility';
import { mappingFor } from '../../utils/mapping-mutations';
import { computeCoverage } from '../../utils/mapping-coverage';
import { ISSUE_CODES } from '@shared/utils/data-collection/issue-codes';

/**
 * Pestaña "Data mapping" del inspector (P-16.5): Domain → Entity → Property filtrada por tipo y
 * por el catálogo (ya filtrado por permisos), badges de requeridos y límites, y editor de optionMap.
 * Presentacional: emite el mapeo nuevo del campo (null = sin mapeo); el padre lo pasa por el store.
 */
@Component({
  selector: 'app-field-mapping-editor',
  imports: [FormSelectControlComponent, StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4" [attr.aria-labelledby]="ids().title">
      <div>
        <h3 [id]="ids().title" class="text-sm font-bold text-gray-900">Data mapping</h3>
        <p class="mt-1 text-xs text-gray-500">Send this answer to the client record.</p>
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
      } @else if (catalog() && context()) {
        @if (orphan(); as message) {
          <!-- Mapeo que ya no encaja: siempre se puede quitar. -->
          <div class="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900" role="alert" data-testid="mapping-orphan">
            <p>{{ message }}</p>
            <button
              type="button"
              class="mt-2 rounded-full border border-amber-300 bg-white px-3 py-1.5 font-semibold hover:bg-amber-100 disabled:opacity-50"
              [disabled]="disabled()"
              (click)="mappingChange.emit(null)"
            >
              Remove mapping
            </button>
          </div>
        } @else {
        @switch (unavailable()) {
          @case ('unsupportedType') {
            <p class="rounded-2xl bg-gray-50 px-3 py-3 text-xs text-gray-600" data-testid="mapping-unavailable">
              This field type can't be mapped to client data.
            </p>
          }
          @case ('inRepeater') {
            <p class="rounded-2xl bg-gray-50 px-3 py-3 text-xs text-gray-600" data-testid="mapping-unavailable">
              Fields inside a repeating section are mapped from the section settings.
            </p>
          }
          @case ('noTargets') {
            <p class="rounded-2xl bg-gray-50 px-3 py-3 text-xs text-gray-600" data-testid="mapping-unavailable">
              No client property you can use accepts this field type.
            </p>
          }
          @default {
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
                <label [for]="ids().property" class="mb-1 block text-xs font-semibold text-gray-600">Property</label>
                <app-form-select-control
                  [id]="ids().property"
                  [value]="mapping()?.targetKey ?? ''"
                  [options]="propertyOptions()"
                  placeholder="Not mapped"
                  [disabled]="disabled()"
                  [describedBy]="usedElsewhere() > 0 ? ids().used : null"
                  (valueChange)="selectTarget($event)"
                />
                @if (usedElsewhere() > 0) {
                  <p [id]="ids().used" class="mt-1 text-xs text-gray-500">
                    {{ usedElsewhere() }} {{ usedElsewhere() === 1 ? 'property is' : 'properties are' }} already
                    mapped from other fields.
                  </p>
                }
              </div>
            </div>

            @if (target(); as current) {
              <div class="flex flex-wrap gap-1.5" data-testid="mapping-badges">
                @for (label of requirements(); track label) {
                  <app-status-pill tone="brand" [soft]="true" [dot]="false" size="xs">
                    Required for: {{ label }}
                  </app-status-pill>
                }
                @for (label of limits(); track label) {
                  <app-status-pill tone="neutral" [soft]="true" [dot]="false" size="xs">{{ label }}</app-status-pill>
                }
              </div>

              @if (warnings().length > 0) {
                <ul class="space-y-1 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="mapping-warnings">
                  @for (warning of warnings(); track warning.message) {
                    <li class="flex flex-wrap items-center justify-between gap-2">
                      <span>{{ warning.message }}</span>
                      @if (warning.fix) {
                        <button
                          type="button"
                          class="shrink-0 rounded-full border border-amber-300 bg-white px-2.5 py-0.5 font-semibold hover:bg-amber-100 disabled:opacity-50"
                          [disabled]="disabled()"
                          (click)="componentPatch.emit(warning.fix)"
                        >
                          {{ warning.fixLabel }}
                        </button>
                      }
                    </li>
                  }
                </ul>
              }

              @if (transformOptions().length > 1) {
                <div>
                  <label [for]="ids().transform" class="mb-1 block text-xs font-semibold text-gray-600">
                    Clean up the answer
                  </label>
                  <app-form-select-control
                    [id]="ids().transform"
                    [value]="mapping()?.transform ?? 'none'"
                    [options]="transformOptions()"
                    placeholder=""
                    [disabled]="disabled()"
                    (valueChange)="setTransform($event)"
                  />
                </div>
              }

              @if (current.dataType === 'enum') {
                <fieldset class="rounded-2xl border border-gray-200 px-3 py-3" data-testid="option-map">
                  <legend class="px-1 text-xs font-semibold text-gray-700">Match the options</legend>
                  @if (options().length === 0) {
                    <p class="text-xs text-gray-500">Add options to this field first.</p>
                  } @else {
                    <div class="space-y-2">
                      @for (option of options(); track option.value; let index = $index) {
                        <div class="grid grid-cols-2 items-center gap-2">
                          <label [for]="ids().option + index" class="truncate text-xs text-gray-700">
                            {{ option.label }}
                          </label>
                          <app-form-select-control
                            [id]="ids().option + index"
                            [value]="mapping()?.optionMap?.[option.value] ?? ''"
                            [options]="enumOptions()"
                            placeholder="Choose a value"
                            [disabled]="disabled()"
                            [invalid]="!mapping()?.optionMap?.[option.value]"
                            (valueChange)="setOption(option.value, $event)"
                          />
                        </div>
                      }
                    </div>
                    <div class="mt-3 flex items-center justify-between gap-2">
                      <p class="text-xs" [class]="optionMapComplete() ? 'text-emerald-700' : 'text-amber-800'" role="status">
                        {{ optionMapComplete() ? 'All options are matched.' : 'Every option needs a client value.' }}
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
                  }
                </fieldset>
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
        }
      }
    </section>
  `,
})
export class FieldMappingEditorComponent {
  readonly definition = input.required<FormDefinition>();
  readonly componentId = input.required<string>();
  readonly catalog = input<MappingCatalog | null>(null);
  readonly loading = input(false);
  readonly error = input('');
  readonly disabled = input(false);

  /** El mapeo nuevo de este campo; null lo quita. */
  readonly mappingChange = output<FormMapping | null>();
  readonly retry = output<void>();
  /** Arreglo de un clic desde un aviso (largo máximo, "today", requerido). */
  readonly componentPatch = output<Partial<FormComponent>>();

  protected readonly ids = computed(() => {
    const id = this.componentId();
    return {
      title: `mapping-title-${id}`,
      domain: `mapping-domain-${id}`,
      entity: `mapping-entity-${id}`,
      property: `mapping-property-${id}`,
      transform: `mapping-transform-${id}`,
      used: `mapping-used-${id}`,
      option: `mapping-option-${id}-`,
    };
  });

  protected readonly context = computed(() => findComponentContext(this.definition(), this.componentId()));
  protected readonly mapping = computed(() => mappingFor(this.definition(), this.componentId()));

  protected readonly unavailable = computed(() => {
    const catalog = this.catalog();
    const context = this.context();
    return catalog && context ? mappingUnavailableReason(catalog, context) : null;
  });

  private readonly compatible = computed(() => {
    const catalog = this.catalog();
    const context = this.context();
    return catalog && context ? compatibleTargets(catalog, context, this.mapping()?.targetKey ?? null) : [];
  });

  protected readonly target = computed(() => {
    const key = this.mapping()?.targetKey;
    return key ? (this.catalog()?.targets.find((target) => target.targetKey === key) ?? null) : null;
  });

  protected readonly domain = linkedSignal(() => this.target()?.domain ?? domainsOf(this.compatible())[0] ?? '');
  protected readonly entity = linkedSignal(() => {
    const current = this.target();
    if (current && current.domain === this.domain()) return current.entity;
    return entitiesOf(this.compatible(), this.domain())[0] ?? '';
  });

  protected readonly domainOptions = computed<FormControlOption[]>(() =>
    domainsOf(this.compatible()).map((value) => ({ value, label: value })),
  );
  protected readonly entityOptions = computed<FormControlOption[]>(() =>
    entitiesOf(this.compatible(), this.domain()).map((value) => ({ value, label: value })),
  );

  // Destinos ya usados por otro campo: el backend exige uno por destino.
  private readonly takenTargets = computed(() => {
    const own = this.componentId();
    return new Set(
      (this.definition().mappings ?? [])
        .filter((mapping) => mapping.componentId !== own)
        .map((mapping) => mapping.targetKey),
    );
  });

  private readonly entityTargets = computed(() =>
    this.compatible().filter((target) => target.domain === this.domain() && target.entity === this.entity()),
  );

  protected readonly propertyOptions = computed<FormControlOption[]>(() =>
    this.entityTargets()
      .filter((target) => !this.takenTargets().has(target.targetKey))
      .map((target) => ({ value: target.targetKey, label: target.displayName })),
  );

  protected readonly usedElsewhere = computed(
    () => this.entityTargets().filter((target) => this.takenTargets().has(target.targetKey)).length,
  );

  protected readonly requirements = computed(() => {
    const target = this.target();
    return target ? requirementLabels(target) : [];
  });
  protected readonly limits = computed(() => {
    const target = this.target();
    return target ? limitLabels(target) : [];
  });
  protected readonly warnings = computed<MappingWarning[]>(() => {
    const target = this.target();
    const context = this.context();
    if (!target || !context) return [];
    const warnings = mappingWarnings(context.component, target);
    const requiredBy = this.requiredBy();
    if (requiredBy.length > 0)
      warnings.push({
        message: `${requiredBy.join(' and ')} needs this value for every client: make the field required.`,
        fixLabel: 'Make required',
        fix: { required: true },
      });
    return warnings;
  });

  // Solo acciones configuradas y el Kind efectivo: la misma regla que `source_not_required` del engine.
  private readonly requiredBy = computed(() => {
    const catalog = this.catalog();
    if (!catalog || !this.mapping()) return [];
    const id = this.componentId();
    return computeCoverage(this.definition(), catalog)
      .actions.filter((action) =>
        action.fieldProblems.some(
          (problem) => problem.componentId === id && problem.code === ISSUE_CODES.mappingSourceNotRequired,
        ),
      )
      .map((action) => action.label);
  });

  /** Mensaje si el mapeo existente ya no encaja con el campo (movido, restringido, destino ausente). */
  protected readonly orphan = computed<string | null>(() => {
    const mapping = this.mapping();
    const context = this.context();
    if (!mapping || !context) return null;
    const target = this.target();
    if (!target) return `This field is mapped to “${mapping.targetKey}”, which isn't available to you.`;
    if (context.inRepeater) return 'This field is now inside a repeating section, so its mapping no longer applies.';
    if (!isTargetCompatible(context, target)) return `This field no longer fits “${target.displayName}”.`;
    return null;
  });

  protected readonly transformOptions = computed<FormControlOption[]>(() => {
    const target = this.target();
    return target
      ? allowedTransforms(target.dataType).map((value) => ({ value, label: TRANSFORM_LABELS[value] }))
      : [];
  });

  protected readonly options = computed(() => {
    const context = this.context();
    return context ? componentOptions(context.component) : [];
  });
  protected readonly enumOptions = computed<FormControlOption[]>(() =>
    (this.target()?.enumValues ?? []).map((value) => ({ value, label: value })),
  );
  protected readonly optionMapComplete = computed(() =>
    isOptionMapComplete(this.options(), this.mapping()?.optionMap, this.target()?.enumValues ?? []),
  );

  protected selectTarget(targetKey: string): void {
    const context = this.context();
    if (!targetKey) {
      this.mappingChange.emit(null);
      return;
    }
    const target = this.catalog()?.targets.find((item) => item.targetKey === targetKey);
    if (!context || !target || targetKey === this.mapping()?.targetKey) return;
    this.mappingChange.emit(createMapping(context.component, target));
  }

  protected setTransform(transform: string): void {
    const mapping = this.mapping();
    if (mapping) this.mappingChange.emit({ ...mapping, transform: transform as MappingTransform });
  }

  protected setOption(option: string, value: string): void {
    const mapping = this.mapping();
    if (!mapping) return;
    const optionMap = { ...(mapping.optionMap ?? {}) };
    if (value) optionMap[option] = value;
    else delete optionMap[option];
    this.mappingChange.emit({ ...mapping, optionMap });
  }

  protected autoMatch(): void {
    const mapping = this.mapping();
    const target = this.target();
    if (!mapping || !target) return;
    const optionMap = suggestOptionMap(this.options(), target.enumValues ?? [], mapping.optionMap);
    this.mappingChange.emit({ ...mapping, optionMap });
  }
}
