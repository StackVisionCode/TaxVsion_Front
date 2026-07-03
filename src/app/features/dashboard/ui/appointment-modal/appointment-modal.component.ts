import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { APPOINTMENT_TYPE_CONFIGS, AppointmentTypeConfig } from '../dashboard-mini-calendar/dashboard-mini-calendar.component';

/**
 * Static placeholder client list, replacing the original's
 * CustomerService + TeamMembersService attendee-management flow with a
 * single "Client" select — this widget is scoped to appointment creation
 * only (no edit mode, no attendee list, no real backend).
 */
interface FakeClient {
  id: string;
  name: string;
}

interface RecurrencePatternConfig {
  id: number;
  label: string;
}

const RECURRENCE_PATTERN_CONFIGS: RecurrencePatternConfig[] = [
  { id: 1, label: 'None' },
  { id: 2, label: 'Daily' },
  { id: 3, label: 'Weekly' },
  { id: 4, label: 'Monthly' },
  { id: 5, label: 'Yearly' },
];

interface ReminderMethodConfig {
  id: number;
  label: string;
  icon: string;
}

const REMINDER_METHOD_CONFIGS: ReminderMethodConfig[] = [
  { id: 1, label: 'Email', icon: 'mail-outline' },
  { id: 2, label: 'Push Notification', icon: 'notifications-outline' },
  { id: 3, label: 'SMS', icon: 'chatbubble-outline' },
  { id: 4, label: 'In-App', icon: 'phone-portrait-outline' },
];

/** Shape emitted on save — a plain form snapshot, no backend DTO involved. */
export interface NewAppointmentFormValue {
  clientId: string | null;
  clientName: string | null;
  title: string;
  description: string;
  startDateTime: string;
  endDateTime: string;
  location: string | null;
  meetingUrl: string | null;
  typeId: number;
  isRecurring: boolean;
  recurrencePatternId: number | null;
  reminders: { minutesBefore: number; methodId: number }[];
  notes: string | null;
}

function toDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function defaultStartDateTime(): string {
  return toDateTimeLocal(new Date());
}

function defaultEndDateTime(): string {
  return toDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000));
}

@Component({
  selector: 'app-appointment-modal',
  imports: [CommonModule, ReactiveFormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './appointment-modal.component.html',
  styleUrl: './appointment-modal.component.scss',
})
export class AppointmentModalComponent {
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Output() saved = new EventEmitter<NewAppointmentFormValue>();

  readonly saving = signal(false);

  readonly clients: FakeClient[] = [
    { id: 'client-1', name: 'Maria Gonzalez' },
    { id: 'client-2', name: 'David Chen' },
    { id: 'client-3', name: 'Johnson LLC' },
    { id: 'client-4', name: 'Sarah Miller' },
    { id: 'client-5', name: 'Riverside Bakery' },
  ];

  readonly appointmentTypes: AppointmentTypeConfig[] = APPOINTMENT_TYPE_CONFIGS;
  readonly recurrencePatterns: RecurrencePatternConfig[] = RECURRENCE_PATTERN_CONFIGS;
  readonly reminderMethods: ReminderMethodConfig[] = REMINDER_METHOD_CONFIGS;

  readonly form: FormGroup = this.fb.group({
    clientId: [''],
    title: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    startDateTime: [defaultStartDateTime(), Validators.required],
    endDateTime: [defaultEndDateTime(), Validators.required],
    location: [''],
    meetingUrl: [''],
    typeId: [3, Validators.required],
    isRecurring: [false],
    recurrencePatternId: [null as number | null],
    notes: [''],
    reminders: this.fb.array<FormGroup>([]),
  });

  get reminders(): FormArray {
    return this.form.get('reminders') as FormArray;
  }

  isFieldInvalid(controlName: string): boolean {
    const control = this.form.get(controlName);
    return !!control && control.invalid && (control.dirty || control.touched);
  }

  selectType(typeId: number): void {
    this.form.get('typeId')?.setValue(typeId);
  }

  addReminder(): void {
    this.reminders.push(
      this.fb.group({
        minutesBefore: [30],
        methodId: [1],
      })
    );
  }

  removeReminder(index: number): void {
    this.reminders.removeAt(index);
  }

  getReminderMethodName(methodId: number): string {
    return this.reminderMethods.find(m => m.id === methodId)?.label ?? 'Email';
  }

  save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);

    const raw = this.form.getRawValue();
    const client = this.clients.find(c => c.id === raw.clientId) ?? null;

    const value: NewAppointmentFormValue = {
      clientId: raw.clientId || null,
      clientName: client?.name ?? null,
      title: raw.title.trim(),
      description: raw.description?.trim() || '',
      startDateTime: raw.startDateTime,
      endDateTime: raw.endDateTime,
      location: raw.location?.trim() || null,
      meetingUrl: raw.meetingUrl?.trim() || null,
      typeId: raw.typeId,
      isRecurring: raw.isRecurring,
      recurrencePatternId: raw.isRecurring ? raw.recurrencePatternId : null,
      reminders: raw.reminders,
      notes: raw.notes?.trim() || null,
    };

    // No backend yet — simulate a brief save delay so the spinner state is visible.
    setTimeout(() => {
      this.saving.set(false);
      this.saved.emit(value);
      this.resetForm();
      this.dismiss();
    }, 500);
  }

  dismiss(): void {
    this.close.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.dismiss();
    }
  }

  private resetForm(): void {
    this.reminders.clear();
    this.form.reset({
      clientId: '',
      title: '',
      description: '',
      startDateTime: defaultStartDateTime(),
      endDateTime: defaultEndDateTime(),
      location: '',
      meetingUrl: '',
      typeId: 3,
      isRecurring: false,
      recurrencePatternId: null,
      notes: '',
      reminders: [],
    });
  }
}
