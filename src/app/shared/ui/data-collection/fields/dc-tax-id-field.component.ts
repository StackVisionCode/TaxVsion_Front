import { Component, EventEmitter, Output } from '@angular/core';
import { maskTaxId, type TaxIdentifierKind } from '@shared/utils/data-collection/formats';
import { DcFieldBase } from './dc-field-base';
import { DcFieldShellComponent } from './dc-field-shell.component';

interface TaxIdValue {
  sensitiveRef?: string;
  last4?: string;
  kind?: TaxIdentifierKind;
}

const ALL_KINDS: readonly TaxIdentifierKind[] = ['ssn', 'itin', 'ein'];
// Sin `props.kinds` el validador del engine solo acepta SSN e ITIN.
const DEFAULT_KINDS: readonly TaxIdentifierKind[] = ['ssn', 'itin'];

@Component({
  selector: 'app-dc-tax-id-field',
  imports: [DcFieldShellComponent],
  template: `<app-dc-field-shell
    [component]="component"
    [inputId]="inputId"
    [rowId]="rowId"
    [issues]="issues"
    [prefilled]="prefilled"
  >
    @if (masked) {
      <div
        class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3"
      >
        <span class="font-mono text-sm text-gray-800">{{ masked }}</span>
        @if (!readonly) {
          <button type="button" class="text-sm font-semibold text-brand-bold" (click)="replace()">
            Replace
          </button>
        }
      </div>
    } @else {
      <div [class]="kinds.length > 1 ? 'grid gap-3 sm:grid-cols-[8rem_1fr]' : 'grid gap-3'">
        @if (kinds.length > 1) {
          <select
            class="dc-input"
            [value]="selectedKind"
            [disabled]="readonly"
            aria-label="Tax identifier type"
            (change)="kind = $any($event.target).value"
          >
            @for (option of kinds; track option) {
              <option [value]="option" [selected]="option === selectedKind">
                {{ kindLabel(option) }}
              </option>
            }
          </select>
        }
        <input
          [id]="inputId"
          type="password"
          inputmode="numeric"
          autocomplete="off"
          class="dc-input"
          [placeholder]="kindLabel(selectedKind) + ' (9 digits)'"
          maxlength="11"
          [readOnly]="readonly"
          [attr.aria-describedby]="describedBy"
          [attr.aria-invalid]="!!errorMessage"
          (change)="entered.emit({ kind: selectedKind, value: $any($event.target).value })"
        />
      </div>
    }
  </app-dc-field-shell>`,
})
export class DcTaxIdFieldComponent extends DcFieldBase<TaxIdValue> {
  @Output() readonly entered = new EventEmitter<{ kind: TaxIdentifierKind; value: string }>();
  kind: TaxIdentifierKind | null = null;

  /** Tipos permitidos por `props.kinds`, en el orden del catálogo; sin prop válida, SSN e ITIN. */
  get kinds(): readonly TaxIdentifierKind[] {
    const allowed = this.component.props?.['kinds'];
    const kinds = Array.isArray(allowed)
      ? ALL_KINDS.filter((kind) => allowed.includes(kind))
      : [];
    return kinds.length > 0 ? kinds : DEFAULT_KINDS;
  }

  get selectedKind(): TaxIdentifierKind {
    return this.kind != null && this.kinds.includes(this.kind) ? this.kind : this.kinds[0];
  }

  kindLabel(kind: TaxIdentifierKind): string {
    return kind.toUpperCase();
  }

  get masked(): string {
    return this.value?.last4 && this.value.kind ? maskTaxId(this.value.last4, this.value.kind) : '';
  }
  replace(): void {
    this.value = null;
  }
}
