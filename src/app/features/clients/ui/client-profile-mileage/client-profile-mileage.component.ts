import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface MileageVehicle {
  make: string;
  model: string;
  year: number;
  plate: string;
}

interface MileageTrip {
  id: string;
  purpose: string;
  status: 'completed' | 'in-progress';
  startAddress: string;
  endAddress: string;
  /** ISO datetime string. */
  startTime: string;
  /** ISO datetime string. */
  endTime: string;
  distanceMiles: number;
  vehicle: MileageVehicle;
  accumulatedMilesBefore: number;
  accumulatedMilesAfter: number;
}

/** IRS-style standard mileage rate used for the estimated reimbursement stat. */
const MILEAGE_RATE = 0.7;

const VEHICLE: MileageVehicle = { make: 'Toyota', model: 'Camry', year: 2022, plate: 'FL-7DXK21' };

function trip(
  id: string,
  purpose: string,
  startAddress: string,
  endAddress: string,
  startTime: string,
  endTime: string,
  distanceMiles: number,
  accumulatedMilesBefore: number,
): MileageTrip {
  return {
    id,
    purpose,
    status: 'completed',
    startAddress,
    endAddress,
    startTime,
    endTime,
    distanceMiles,
    vehicle: VEHICLE,
    accumulatedMilesBefore,
    accumulatedMilesAfter: accumulatedMilesBefore + distanceMiles,
  };
}

const MOCK_TRIPS: MileageTrip[] = [
  trip('trip-1', 'Client meeting', '482 Coral Way, Miami, FL', '1200 Brickell Ave, Miami, FL', '2026-06-28T09:00', '2026-06-28T09:35', 8.4, 12406.2),
  trip('trip-2', 'Bank deposit', '482 Coral Way, Miami, FL', '350 SE 2nd St, Miami, FL', '2026-06-20T13:10', '2026-06-20T13:28', 4.1, 12402.1),
  trip('trip-3', 'Office supplies run', '482 Coral Way, Miami, FL', '7795 W Flagler St, Miami, FL', '2026-06-15T11:00', '2026-06-15T11:22', 6.7, 12395.4),
  trip('trip-4', 'Client meeting', '482 Coral Way, Miami, FL', '95 Merrick Way, Coral Gables, FL', '2026-06-08T15:30', '2026-06-08T16:05', 5.9, 12389.5),
  trip('trip-5', 'IRS office visit', '482 Coral Way, Miami, FL', '51 SW 1st Ave, Miami, FL', '2026-05-29T10:00', '2026-05-29T10:40', 9.2, 12380.3),
  trip('trip-6', 'Client meeting', '482 Coral Way, Miami, FL', '2601 S Bayshore Dr, Miami, FL', '2026-05-19T14:00', '2026-05-19T14:30', 7.3, 12373.0),
];

/**
 * Pestaña "Mileage" del perfil de cliente (puerto visual/estructural de
 * `customer-mileage`): layout dividido lista+detalle, solo lectura (igual
 * que el legacy, los trips son de solo lectura). Se descarta por completo el
 * mapa (Leaflet en el original) al no existir dependencia de mapas en este
 * proyecto — el detalle muestra origen/destino como texto plano.
 */
@Component({
  selector: 'app-client-profile-mileage',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-mileage.component.html',
})
export class ClientProfileMileageComponent {
  @Input() clientId = '';

  readonly trips = signal<MileageTrip[]>([...MOCK_TRIPS]);
  readonly selectedTripId = signal<string | null>(MOCK_TRIPS[0]?.id ?? null);

  readonly selectedTrip = computed<MileageTrip | null>(() => {
    const id = this.selectedTripId();
    return this.trips().find(item => item.id === id) ?? null;
  });

  readonly totalMiles = computed(() => this.trips().reduce((sum, item) => sum + item.distanceMiles, 0));

  readonly estimatedReimbursement = computed(() => this.totalMiles() * MILEAGE_RATE);

  selectTrip(id: string): void {
    this.selectedTripId.set(id);
  }

  statusLabel(status: MileageTrip['status']): string {
    return status === 'completed' ? 'Completed' : 'In progress';
  }

  statusChip(status: MileageTrip['status']): string {
    return status === 'completed' ? 'border-emerald-200 text-emerald-600' : 'border-indigo-200 text-indigo-600';
  }

  statusDot(status: MileageTrip['status']): string {
    return status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500';
  }

  formatMiles(miles: number): string {
    return `${miles.toFixed(1)} mi`;
  }

  formatCurrency(amount: number): string {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  }

  formatDate(datetime: string): string {
    return new Date(datetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatTimeRange(startTime: string, endTime: string): string {
    const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    const start = new Date(startTime).toLocaleTimeString('en-US', opts);
    const end = new Date(endTime).toLocaleTimeString('en-US', opts);
    return `${start} – ${end}`;
  }

  durationMinutes(startTime: string, endTime: string): number {
    return Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
  }
}
