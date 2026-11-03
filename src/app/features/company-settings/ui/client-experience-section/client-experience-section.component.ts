import { Component, input, output } from '@angular/core';
import { CompanyProfile } from '../../data-access/company-settings.model';
import { FormField, LINK_MAX } from '../../utils/office-profile-rules';
import { BusinessHoursEditorComponent } from '../business-hours-editor/business-hours-editor.component';
import { SectionHeaderComponent } from '../section-header/section-header.component';

type Errors = Partial<Record<FormField, string>>;

/** Lo que el cliente ve en su portal: horario de atención y enlaces para citas y reseñas. */
@Component({
  selector: 'app-client-experience-section',
  imports: [SectionHeaderComponent, BusinessHoursEditorComponent],
  template: `
    <app-cs-section-header icon="time-outline" heading="Client experience" titleId="experience-title"
      description="Shown in your client portal. Hours use your office time zone." />

    <app-business-hours-editor class="mt-6" [hours]="profile().hours" [disabled]="disabled()" [backendError]="errors().hours"
      (hoursChange)="patch.emit({ hours: $event })" />

    <div class="mt-6 grid gap-4 sm:grid-cols-2">
      <label class="pf-field">
        <span class="pf-field__label">Booking link</span>
        <input type="url" [value]="profile().bookingUrl" (input)="link('bookingUrl', $event)" (blur)="touched.emit('bookingUrl')"
          [disabled]="disabled()" class="pf-input" [class.border-red-400]="!!errors().bookingUrl" [attr.aria-invalid]="!!errors().bookingUrl"
          [attr.maxlength]="linkMax" placeholder="calendly.com/yourfirm" aria-describedby="booking-hint" />
        @if (errors().bookingUrl; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        } @else {
          <span id="booking-hint" class="text-xs text-gray-500">Where clients book an appointment.</span>
        }
      </label>
      <label class="pf-field">
        <span class="pf-field__label">Review link</span>
        <input type="url" [value]="profile().reviewUrl" (input)="link('reviewUrl', $event)" (blur)="touched.emit('reviewUrl')"
          [disabled]="disabled()" class="pf-input" [class.border-red-400]="!!errors().reviewUrl" [attr.aria-invalid]="!!errors().reviewUrl"
          [attr.maxlength]="linkMax" placeholder="g.page/r/yourfirm/review" aria-describedby="review-hint" />
        @if (errors().reviewUrl; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        } @else {
          <span id="review-hint" class="text-xs text-gray-500">Where happy clients leave a review.</span>
        }
      </label>
    </div>
  `,
})
export class ClientExperienceSectionComponent {
  readonly profile = input.required<CompanyProfile>();
  readonly disabled = input(false);
  readonly errors = input<Errors>({});

  readonly patch = output<Partial<CompanyProfile>>();
  readonly touched = output<FormField>();

  readonly linkMax = LINK_MAX;

  link(key: 'bookingUrl' | 'reviewUrl', event: Event): void {
    this.patch.emit({ [key]: (event.target as HTMLInputElement).value });
  }
}
