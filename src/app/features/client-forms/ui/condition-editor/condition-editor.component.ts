import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormCheckboxControlComponent } from '@shared/ui/form-controls/form-checkbox-control.component';
import {
  FormSelectControlComponent,
  type FormControlOption,
} from '@shared/ui/form-controls/form-select-control.component';
import { FormTextControlComponent } from '@shared/ui/form-controls/form-text-control.component';
import { SegmentedComponent, type SegmentedOption } from '@shared/ui/segmented/segmented.component';
import type { Condition } from '@shared/utils/data-collection/conditions';
import { getComponentType } from '@shared/utils/data-collection/component-registry';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';

@Component({
  selector: 'app-condition-editor',
  imports: [
    FormCheckboxControlComponent,
    FormSelectControlComponent,
    FormTextControlComponent,
    SegmentedComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="space-y-3 border-t border-gray-100 pt-4">
      <legend class="text-sm font-bold text-gray-900">Visibility</legend>
      <app-form-checkbox-control [checked]="condition != null" (checkedChange)="toggle($event)">
        Show this item conditionally
      </app-form-checkbox-control>
      @if (condition) {
        <div>
          <span class="text-xs font-semibold text-gray-600">Match</span>
          <app-segmented
            class="mt-1 block"
            [options]="modeOptions"
            [value]="mode()"
            (valueChange)="setMode($event)"
          />
        </div>
        <div class="space-y-3">
          @for (rule of rules(); track $index; let index = $index) {
            <div class="space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-gray-700">Rule {{ index + 1 }}</span>
                @if (rules().length > 1) {
                  <button
                    type="button"
                    class="text-xs font-semibold text-red-700"
                    (click)="removeRule(index)"
                  >
                    Remove
                  </button>
                }
              </div>
              <label class="block text-xs font-semibold text-gray-600"
                >Earlier field
                <app-form-select-control
                  class="mt-1 block"
                  [value]="rule.field || ''"
                  [options]="fieldOptions"
                  placeholder="Choose a field"
                  (valueChange)="fieldChanged(index, $event)"
                />
              </label>
              <label class="block text-xs font-semibold text-gray-600"
                >Operator
                <app-form-select-control
                  class="mt-1 block"
                  [value]="rule.op || 'isAnswered'"
                  [options]="operatorOptions(rule)"
                  [placeholder]="''"
                  (valueChange)="operatorChanged(index, $event)"
                />
              </label>
              @if (requiresValue(rule.op)) {
                <label class="block text-xs font-semibold text-gray-600"
                  >Value
                  @if (valueOptions(rule).length > 0) {
                    <app-form-select-control
                      class="mt-1 block"
                      [value]="displayValue(rule)"
                      [options]="valueOptions(rule)"
                      placeholder="Choose a value"
                      (valueChange)="valueChanged(index, $event)"
                    />
                  } @else {
                    <app-form-text-control
                      class="mt-1 block"
                      [type]="valueType(rule)"
                      [value]="displayValue(rule)"
                      (valueChange)="valueChanged(index, $event)"
                    />
                  }
                </label>
              }
            </div>
          }
        </div>
        <button
          type="button"
          class="w-full rounded-full border border-dashed border-gray-300 px-3 py-2 text-xs font-semibold text-brand-bold disabled:opacity-40"
          [disabled]="rules().length >= 10"
          (click)="addRule()"
        >
          + Add rule
        </button>
      }
    </fieldset>
  `,
})
export class ConditionEditorComponent {
  @Input() condition: Condition | null = null;
  @Input() fields: FormComponent[] = [];
  @Output() readonly conditionChange = new EventEmitter<Condition | null>();

  readonly modeOptions: readonly SegmentedOption[] = [
    { id: 'all', label: 'All rules' },
    { id: 'any', label: 'Any rule' },
  ];

  get fieldOptions(): readonly FormControlOption[] {
    return this.fields.map((field) => ({
      value: field.id,
      label: field.label || this.label(field.type),
    }));
  }

  mode(): 'all' | 'any' {
    return this.condition?.any != null ? 'any' : 'all';
  }

  rules(): Condition[] {
    if (!this.condition) return [];
    if (this.condition.all) return this.condition.all;
    if (this.condition.any) return this.condition.any;
    return [this.condition];
  }

  toggle(enabled: boolean): void {
    this.conditionChange.emit(enabled ? { all: [this.emptyRule()] } : null);
  }

  setMode(mode: string | number): void {
    this.emitRules(String(mode) === 'any' ? 'any' : 'all', this.rules());
  }

  addRule(): void {
    if (this.rules().length >= 10) return;
    this.emitRules(this.mode(), [...this.rules(), this.emptyRule()]);
  }

  removeRule(index: number): void {
    const rules = this.rules().filter((_, itemIndex) => itemIndex !== index);
    this.emitRules(this.mode(), rules.length > 0 ? rules : [this.emptyRule()]);
  }

  fieldChanged(index: number, fieldId: string): void {
    this.updateRule(index, { field: fieldId || null, op: 'isAnswered' });
  }

  operatorChanged(index: number, op: string): void {
    const rule = this.rules()[index];
    this.updateRule(index, {
      field: rule.field ?? null,
      op,
      ...(this.requiresValue(op) ? { value: this.defaultValue(rule, op) } : {}),
    });
  }

  valueChanged(index: number, raw: string): void {
    const rule = this.rules()[index];
    const field = this.field(rule);
    let value: unknown = raw;
    if (field?.type === 'number' || field?.type === 'currency')
      value = raw === '' ? null : Number(raw);
    if (field?.type === 'yesNo' || field?.type === 'checkbox') value = raw === 'true';
    if (rule.op === 'in' || rule.op === 'notIn') value = raw === '' ? [] : [raw];
    this.updateRule(index, { ...rule, value });
  }

  operatorOptions(rule: Condition): readonly FormControlOption[] {
    const field = this.field(rule);
    const operators = field
      ? [...(getComponentType(field.type)?.allowedOperators ?? ['isAnswered'])]
      : ['isAnswered'];
    return operators.map((value) => ({ value, label: this.operatorLabel(value) }));
  }

  valueOptions(rule: Condition): readonly FormControlOption[] {
    const field = this.field(rule);
    if (!field) return [];
    if (field.type === 'yesNo' || field.type === 'checkbox')
      return [
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ];
    const options = field.props?.['options'];
    return Array.isArray(options)
      ? options.flatMap((option) =>
          typeof option === 'object' &&
          option != null &&
          'value' in option &&
          'label' in option &&
          typeof option.value === 'string' &&
          typeof option.label === 'string'
            ? [{ value: option.value, label: option.label }]
            : [],
        )
      : [];
  }

  valueType(rule: Condition): string {
    const type = this.field(rule)?.type;
    return type === 'number' || type === 'currency' ? 'number' : type === 'date' ? 'date' : 'text';
  }

  displayValue(rule: Condition): string {
    const value = Array.isArray(rule.value) ? rule.value[0] : rule.value;
    return value == null ? '' : String(value);
  }

  requiresValue(op: string | null | undefined): boolean {
    return !['isAnswered', 'isNotAnswered', 'isTrue', 'isFalse'].includes(op ?? '');
  }

  operatorLabel(value: string): string {
    return this.label(value).toLowerCase();
  }

  private field(rule: Condition): FormComponent | undefined {
    return this.fields.find((item) => item.id === rule.field);
  }

  private emptyRule(): Condition {
    return { field: null, op: 'isAnswered' };
  }

  private defaultValue(rule: Condition, op: string): unknown {
    const field = this.field(rule);
    if (op === 'in' || op === 'notIn') return [];
    if (field?.type === 'number' || field?.type === 'currency') return 0;
    if (field?.type === 'yesNo' || field?.type === 'checkbox') return true;
    return '';
  }

  private updateRule(index: number, rule: Condition): void {
    const rules = [...this.rules()];
    rules[index] = rule;
    this.emitRules(this.mode(), rules);
  }

  private emitRules(mode: 'all' | 'any', rules: Condition[]): void {
    this.conditionChange.emit(mode === 'all' ? { all: rules } : { any: rules });
  }

  private label(value: string): string {
    return value.replace(/([A-Z])/g, ' $1').replace(/^./, (item) => item.toUpperCase());
  }
}
