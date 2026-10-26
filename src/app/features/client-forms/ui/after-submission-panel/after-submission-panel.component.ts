import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormCheckboxControlComponent } from '@shared/ui/form-controls/form-checkbox-control.component';
import {
  FormSelectControlComponent,
  type FormControlOption,
} from '@shared/ui/form-controls/form-select-control.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import type {
  FormAction,
  FormActionTrigger,
  FormDefinition,
} from '@shared/utils/data-collection/form-definition.model';
import { isRecord } from '@shared/utils/data-collection/properties';
import type { MappingCatalog } from '../../data-access/mapping-catalog.model';
import {
  FORM_ACTION_CATALOG,
  type FormActionDescriptor,
  TRIGGER_LABELS,
  hasSignatureStep,
  nextActionKey,
  operationLabel,
} from '../../utils/form-action-catalog';
import { type ActionCoverage, actionCoverage } from '../../utils/mapping-coverage';

const MAPPED = '__mapped';
const ADDRESS_TARGETS = ['customer.address.home', 'customer.address.mailing'];

interface ActionRow {
  descriptor: FormActionDescriptor;
  action: FormAction | null;
  /** Por qué no se puede activar; null si se puede. */
  blocked: string | null;
  /** La quitaría el validador de firma: va atada al componente signatureStep. */
  lockedBySignature: boolean;
  coverage: ActionCoverage | null;
}

interface ConfigField {
  key: 'kind' | 'language';
  label: string;
  options: FormControlOption[];
}

/**
 * Panel de plantilla "After submission" (P-17): activa y configura `definition.actions` solo con el
 * catálogo cerrado de P-17.1. Sin scripts, HTTP ni SQL. Emite la lista de acciones nueva; el padre
 * la aplica con `store.change(...)`.
 */
@Component({
  selector: 'app-after-submission-panel',
  imports: [FormCheckboxControlComponent, FormSelectControlComponent, StatusPillComponent, SwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-3" aria-labelledby="after-submission-title">
      <div>
        <h3 id="after-submission-title" class="text-sm font-bold text-gray-900">After submission</h3>
        <p class="mt-1 text-xs text-gray-500">What happens when a client sends this form.</p>
      </div>

      @for (row of rows(); track row.descriptor.type) {
        <article
          class="rounded-2xl border border-gray-200 bg-white px-3 py-3"
          [attr.data-action-type]="row.descriptor.type"
          [attr.aria-labelledby]="'action-title-' + row.descriptor.type"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-1.5">
                <h4 [id]="'action-title-' + row.descriptor.type" class="text-xs font-bold text-gray-900">
                  {{ row.descriptor.label }}
                </h4>
                @if (row.descriptor.implicit) {
                  <app-status-pill tone="success" [soft]="true" [dot]="false" size="xs">Always on</app-status-pill>
                } @else if (row.descriptor.availability === 'comingSoon') {
                  <app-status-pill tone="muted" [soft]="true" [dot]="false" size="xs">Coming soon</app-status-pill>
                }
              </div>
              <p [id]="'action-desc-' + row.descriptor.type" class="mt-1 text-xs text-gray-500">
                {{ row.descriptor.description }}
              </p>
            </div>
            @if (!row.descriptor.implicit) {
              <app-switch
                size="sm"
                [checked]="row.action !== null"
                [disabled]="switchDisabled(row)"
                [ariaLabel]="(row.action ? 'Turn off ' : 'Turn on ') + row.descriptor.label"
                (checkedChange)="toggle(row, $event)"
              />
            }
          </div>

          @if (row.blocked && row.descriptor.availability !== 'comingSoon') {
            <p class="mt-2 text-xs text-gray-600" data-testid="action-blocked">{{ row.blocked }}</p>
          }
          @if (row.descriptor.type === 'requestSignature' && signatureStepEnabled() === false) {
            <p class="mt-2 text-xs text-gray-600" data-testid="signature-off">
              Signature steps are turned off for this office.
            </p>
          }
          @if (row.descriptor.implicit && row.action) {
            <div class="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="legacy-action">
              <p>This draft has an old “{{ row.descriptor.label }}” entry. It always happens, so it can't be configured and blocks publishing.</p>
              <button
                type="button"
                class="mt-1 rounded-full border border-amber-300 bg-white px-2.5 py-0.5 font-semibold hover:bg-amber-100 disabled:opacity-50"
                [disabled]="disabled()"
                (click)="removeLegacy(row.action)"
              >
                Remove entry
              </button>
            </div>
          }
          @if (row.lockedBySignature) {
            <p class="mt-2 text-xs text-gray-600">Added with the signature step. Remove the step to remove it.</p>
          }

          @if (row.action && !row.descriptor.implicit) {
            <div class="mt-3 space-y-3 border-t border-gray-100 pt-3">
              @if (row.descriptor.triggers.length > 1) {
                <fieldset [disabled]="disabled() || row.descriptor.availability === 'comingSoon'">
                  <legend class="mb-1 text-xs font-semibold text-gray-600">
                    {{ row.descriptor.type === 'createCustomer' ? 'How the client is created' : 'When it runs' }}
                  </legend>
                  <div class="space-y-1.5">
                    @for (trigger of row.descriptor.triggers; track trigger) {
                      <label class="flex cursor-pointer items-start gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                        <input
                          type="radio"
                          class="mt-0.5 accent-brand-bold"
                          [name]="'trigger-' + row.action.key"
                          [value]="trigger"
                          [checked]="row.action.trigger === trigger"
                          [disabled]="triggerDisabled(row, trigger)"
                          (change)="setTrigger(row.action, trigger)"
                        />
                        <span>
                          <span class="block font-semibold text-gray-800">{{ triggerLabel(row, trigger) }}</span>
                          @if (row.descriptor.type === 'createCustomer') {
                            <span class="block text-gray-500">{{ createModeHint(trigger) }}</span>
                          }
                        </span>
                      </label>
                    }
                  </div>
                </fieldset>
              } @else {
                <p class="text-xs text-gray-600">{{ triggerLabel(row, row.descriptor.triggers[0]) }}</p>
              }

              @if (row.descriptor.type === 'createCustomer') {
                @if (autoCustomerCreationEnabled() === false) {
                  <p class="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="auto-off">
                    Automatic client creation is turned off for this office. Staff can still create the client
                    manually.
                  </p>
                }
                @for (field of configFields(); track field.key) {
                  <div>
                    <label [for]="'action-config-' + row.action.key + '-' + field.key" class="mb-1 block text-xs font-semibold text-gray-600">
                      {{ field.label }}
                    </label>
                    <app-form-select-control
                      [id]="'action-config-' + row.action.key + '-' + field.key"
                      [value]="valueSource(row.action, field.key)"
                      [options]="field.options"
                      placeholder=""
                      [disabled]="disabled()"
                      (valueChange)="setValueSource(row.action, field.key, $event)"
                    />
                  </div>
                }
                <app-form-checkbox-control
                  [id]="'action-config-' + row.action.key + '-address'"
                  [checked]="wantsAddress(row.action)"
                  [disabled]="disabled()"
                  [describedBy]="addressMapped() ? null : 'action-address-hint-' + row.action.key"
                  (checkedChange)="setAddress(row.action, $event)"
                >
                  Save the mapped address to the new client
                </app-form-checkbox-control>
                @if (!addressMapped()) {
                  <p [id]="'action-address-hint-' + row.action.key" class="-mt-2 text-xs text-gray-500">
                    Map an address field to use this.
                  </p>
                }
                <app-form-checkbox-control [id]="'action-config-' + row.action.key + '-wait'" [checked]="false" [disabled]="true">
                  Wait for the client's signature first <span class="text-gray-500">· Coming soon</span>
                </app-form-checkbox-control>
              }
            </div>
          }

          @if (!row.descriptor.implicit && (row.descriptor.requirements.length > 0 || row.coverage)) {
            <div class="mt-3 space-y-1.5" [attr.aria-label]="row.descriptor.label + ' requirements'">
              @for (requirement of row.descriptor.requirements; track requirement) {
                <p class="text-xs text-gray-500">· {{ requirement }}</p>
              }
              @if (row.coverage?.state === 'ready') {
                <p class="text-xs font-semibold text-emerald-700" data-testid="action-ready">
                  ✔ Ready for {{ operationLabel(row.coverage!.operation ?? '') }}
                </p>
              } @else if (row.coverage?.state === 'missing') {
                <div class="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="action-missing">
                  @if (row.coverage!.missing.length > 0) {
                    <p>
                      Missing mappings: {{ missingNames(row.coverage!) }}.
                    </p>
                  } @else {
                    <p>Some mapped fields need attention.</p>
                  }
                  <button
                    type="button"
                    class="mt-1 font-semibold underline-offset-2 hover:underline"
                    (click)="coverageRequested.emit(row.action!.key)"
                  >
                    Review mapping coverage
                  </button>
                </div>
              }
            </div>
          }
        </article>
      }
    </section>
  `,
})
export class AfterSubmissionPanelComponent {
  readonly definition = input.required<FormDefinition>();
  readonly catalog = input<MappingCatalog | null>(null);
  readonly catalogLoading = input(false);
  /** Módulos del plan de la oficina (`AccessStore.enabledModules`); null = sin datos, no oculta nada. */
  readonly modules = input<ReadonlySet<string> | null>(null);
  /** Flag de la oficina para crear clientes al enviar; null = el backend no lo informó. */
  readonly autoCustomerCreationEnabled = input<boolean | null>(null);
  /** Flag de la oficina para el paso de firma; null = sin datos. */
  readonly signatureStepEnabled = input<boolean | null>(null);
  readonly disabled = input(false);

  readonly actionsChange = output<FormAction[]>();
  /** Pide mostrar la cobertura de una acción (clave de la acción). */
  readonly coverageRequested = output<string>();

  protected readonly operationLabel = operationLabel;

  private readonly actions = computed(() => this.definition().actions ?? []);

  protected readonly rows = computed<ActionRow[]>(() => {
    const definition = this.definition();
    const catalog = this.catalog();
    const signatureStep = hasSignatureStep(definition);
    return FORM_ACTION_CATALOG.map((descriptor) => {
      const action = this.actions().find((item) => item.type === descriptor.type) ?? null;
      const coverage =
        action && catalog && descriptor.mappingOperation ? actionCoverage(definition, catalog, action) : null;
      return {
        descriptor,
        action,
        blocked: this.blockedReason(descriptor),
        lockedBySignature: descriptor.type === 'requestSignature' && action !== null && signatureStep,
        coverage,
      };
    });
  });

  protected readonly configFields = computed<ConfigField[]>(() => {
    const catalog = this.catalog();
    const operation = catalog?.operations.find((item) => item.name === 'CreateCustomer');
    if (!catalog || !operation) return [];
    const fields: ConfigField[] = [];
    for (const [key, label] of [
      ['kind', 'Client type'],
      ['language', 'Preferred language'],
    ] as const) {
      const target = catalog.targets.find((item) => item.targetKey === operation.configTargets[key]);
      if (!target) continue;
      fields.push({
        key,
        label,
        options: [
          { value: MAPPED, label: 'Answered in the form' },
          ...(target.enumValues ?? []).map((value) => ({ value, label: `Always ${value}` })),
        ],
      });
    }
    return fields;
  });

  protected readonly addressMapped = computed(() =>
    (this.definition().mappings ?? []).some((mapping) => ADDRESS_TARGETS.includes(mapping.targetKey)),
  );

  private blockedReason(descriptor: FormActionDescriptor): string | null {
    if (descriptor.implicit) return null;
    if (descriptor.availability === 'comingSoon') return 'Coming soon';
    const modules = this.modules();
    if (descriptor.module && modules && !modules.has(descriptor.module))
      return "Your office plan doesn't include this feature.";
    if (descriptor.type === 'requestSignature' && this.signatureStepEnabled() === false)
      return 'Signature steps are turned off for this office.';
    if (!descriptor.mappingOperation) return null;
    const catalog = this.catalog();
    if (!catalog) return this.catalogLoading() ? 'Loading client properties…' : 'Client properties are unavailable.';
    return catalog.operations.some((item) => item.name === descriptor.mappingOperation)
      ? null
      : "You don't have permission to configure this action.";
  }

  protected switchDisabled(row: ActionRow): boolean {
    if (this.disabled() || row.lockedBySignature) return true;
    // Una acción ya presente siempre se puede apagar, aunque hoy no se pueda activar.
    return row.action === null && row.blocked !== null;
  }

  protected triggerDisabled(row: ActionRow, trigger: FormActionTrigger): boolean {
    return (
      row.descriptor.type === 'createCustomer' &&
      trigger === 'onSubmit' &&
      this.autoCustomerCreationEnabled() === false &&
      row.action?.trigger !== 'onSubmit'
    );
  }

  protected triggerLabel(row: ActionRow, trigger: FormActionTrigger): string {
    if (row.descriptor.type === 'createCustomer') return trigger === 'onSubmit' ? 'Automatic' : 'Manual';
    return TRIGGER_LABELS[trigger];
  }

  protected createModeHint(trigger: FormActionTrigger): string {
    return trigger === 'onSubmit'
      ? 'Create the client as soon as the form is submitted.'
      : 'Staff create the client from the review.';
  }

  protected toggle(row: ActionRow, on: boolean): void {
    const actions = this.actions();
    if (!on) {
      if (row.action) this.actionsChange.emit(actions.filter((item) => item.key !== row.action!.key));
      return;
    }
    if (row.action || row.blocked) return;
    this.actionsChange.emit([...actions, this.defaultAction(row.descriptor, actions)]);
  }

  private defaultAction(descriptor: FormActionDescriptor, actions: readonly FormAction[]): FormAction {
    const action: FormAction = {
      key: nextActionKey(actions, descriptor.key),
      type: descriptor.type,
      trigger: descriptor.defaultTrigger,
    };
    if (descriptor.type !== 'createCustomer') return action;
    if (this.autoCustomerCreationEnabled() === false) action.trigger = 'manual';
    const kinds = this.configFields().find((field) => field.key === 'kind')?.options ?? [];
    // Si ya hay un campo mapeado al tipo de cliente, se respeta en vez de fijar una constante.
    const kindMapped = this.isConfigTargetMapped('kind');
    action.config = {
      kind:
        !kindMapped && kinds.some((option) => option.value === 'Individual')
          ? { constant: 'Individual' }
          : { mapped: true },
      language: { mapped: true },
      waitFor: 'none',
    };
    return action;
  }

  private isConfigTargetMapped(key: 'kind' | 'language'): boolean {
    const operation = this.catalog()?.operations.find((item) => item.name === 'CreateCustomer');
    const targetKey = operation?.configTargets[key];
    return targetKey != null && (this.definition().mappings ?? []).some((mapping) => mapping.targetKey === targetKey);
  }

  /** Borradores viejos con acciones implícitas: no se publican, así que se pueden quitar. */
  protected removeLegacy(action: FormAction): void {
    this.actionsChange.emit(this.actions().filter((item) => item.key !== action.key));
  }

  protected setTrigger(action: FormAction, trigger: FormActionTrigger): void {
    this.replace({ ...action, trigger });
  }

  protected valueSource(action: FormAction, key: 'kind' | 'language'): string {
    const source = action.config?.[key];
    return isRecord(source) && typeof source['constant'] === 'string' ? source['constant'] : MAPPED;
  }

  protected setValueSource(action: FormAction, key: 'kind' | 'language', value: string): void {
    const source = value === MAPPED || !value ? { mapped: true } : { constant: value };
    this.replace({ ...action, config: { ...(action.config ?? {}), [key]: source } });
  }

  protected wantsAddress(action: FormAction): boolean {
    const postCreate = action.config?.['postCreate'];
    return Array.isArray(postCreate) && postCreate.includes('primaryAddress');
  }

  protected setAddress(action: FormAction, on: boolean): void {
    const config = { ...(action.config ?? {}) };
    if (on) config['postCreate'] = ['primaryAddress'];
    else delete config['postCreate'];
    this.replace({ ...action, config });
  }

  protected missingNames(coverage: ActionCoverage): string {
    return coverage.missing
      .map((item) => (item.kinds.length > 0 ? `${item.displayName} (${item.kinds.join(', ')})` : item.displayName))
      .join(', ');
  }

  private replace(next: FormAction): void {
    this.actionsChange.emit(this.actions().map((item) => (item.key === next.key ? next : item)));
  }
}
