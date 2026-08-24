/**
 * Espejo mínimo del contrato de Calendar.Api (`/calendar/appointments` vía Gateway)
 * para el mini calendario del dashboard. Solo se consume el listado por rango:
 * GET /calendar/appointments?from=&to= → OccurrenceResponse[].
 *
 * "Occurrence" (no "appointment") porque el backend expande las citas recurrentes:
 * una cita semanal devuelve una fila por ocurrencia dentro del rango, todas con el
 * mismo `appointmentId` pero distinto `startUtc`.
 */

/** Espejo de TaxVision.Calendar.Application.Appointments.OccurrenceResponse. */
export interface OccurrenceResponse {
  appointmentId: string;
  originalStartUtc: string;
  startUtc: string;
  endUtc: string;
  /** La ocurrencia fue movida/editada respecto a la serie. */
  isException: boolean;
  title: string;
  location: string | null;
}

/** Evento ya normalizado a hora local para pintar el calendario. */
export interface CalendarEvent {
  /** appointmentId + inicio: una serie recurrente repite appointmentId. */
  id: string;
  title: string;
  location: string | null;
  date: Date;
  endDate: Date;
}

export function toCalendarEvent(response: OccurrenceResponse): CalendarEvent {
  return {
    id: `${response.appointmentId}:${response.startUtc}`,
    title: response.title,
    location: response.location,
    date: new Date(response.startUtc),
    endDate: new Date(response.endUtc),
  };
}
