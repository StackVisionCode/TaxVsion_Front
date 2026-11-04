import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { OffboardImpactItem, OffboardingParticipant, OffboardingStatus } from './user-management.model';

/**
 * Un renglón del impacto: el campo de la respuesta del servicio y qué le pasa con o sin sucesor
 * (`{name}` = nombre del sucesor). Un campo booleano cuenta como 1.
 */
interface ImpactField {
  field: string;
  key: string;
  label: string;
  icon: string;
  withSuccessor: string;
  withoutSuccessor: string;
}

type ImpactResponse = Record<string, number | boolean>;

// Solo el texto de cada renglón vive acá (es copy de pantalla). Qué servicios participan y cómo llamarlos lo
// dice Auth (`GET /auth/offboarding/participants`); un servicio nuevo sin texto aquí sale con un renglón genérico.
const IMPACT_COPY: Readonly<Record<string, readonly ImpactField[]>> = {
  Customer: [
    { field: 'primaryClients', key: 'clients', label: 'Clients they prepare', icon: 'people-outline', withSuccessor: 'move to {name}', withoutSuccessor: 'left without a preparer' },
    { field: 'additionalAccess', key: 'clientAccess', label: 'Other clients they can see', icon: 'eye-outline', withSuccessor: 'access removed', withoutSuccessor: 'access removed' },
    { field: 'archivedClients', key: 'archivedClients', label: 'Archived clients', icon: 'archive-outline', withSuccessor: 'released', withoutSuccessor: 'released' },
  ],
  Tasks: [
    { field: 'openTasks', key: 'tasks', label: 'Open tasks', icon: 'checkbox-outline', withSuccessor: 'move to {name}', withoutSuccessor: 'left unassigned' },
    { field: 'openFormRequests', key: 'formRequests', label: 'Open client forms', icon: 'document-text-outline', withSuccessor: 'move to {name}', withoutSuccessor: 'move to you' },
    { field: 'intakeLinks', key: 'intakeLinks', label: 'Public intake links', icon: 'globe-outline', withSuccessor: 'move to {name}', withoutSuccessor: 'paused' },
    { field: 'openClientRequests', key: 'clientRequests', label: 'Document requests', icon: 'folder-open-outline', withSuccessor: 'follow-up moves to {name}', withoutSuccessor: 'follow-up moves to the task owner or you' },
    { field: 'runningTimers', key: 'timers', label: 'Running timers', icon: 'timer-outline', withSuccessor: 'stopped', withoutSuccessor: 'stopped' },
  ],
  Calendar: [
    { field: 'futureAppointments', key: 'appointments', label: 'Upcoming appointments', icon: 'calendar-outline', withSuccessor: 'move to {name}', withoutSuccessor: 'cancelled — clients are notified' },
  ],
  Correspondence: [
    { field: 'openDrafts', key: 'drafts', label: 'Email drafts', icon: 'mail-outline', withSuccessor: 'move to {name}', withoutSuccessor: 'discarded' },
  ],
  CloudStorage: [
    { field: 'activeShareLinks', key: 'shareLinks', label: 'Share links', icon: 'link-outline', withSuccessor: 'revoked', withoutSuccessor: 'revoked' },
    { field: 'officeCloudConnections', key: 'cloudConnections', label: 'Office cloud storage linked to their account', icon: 'cloud-outline', withSuccessor: 'flagged — reconnect with an office account', withoutSuccessor: 'flagged — reconnect with an office account' },
  ],
  Connectors: [
    { field: 'personalMailboxes', key: 'mailboxes', label: 'Personal mailboxes', icon: 'mail-open-outline', withSuccessor: 'disconnected', withoutSuccessor: 'disconnected' },
    { field: 'officeMailboxes', key: 'officeMailboxes', label: 'Office mailboxes linked to their account', icon: 'business-outline', withSuccessor: 'flagged — reconnect with an office account', withoutSuccessor: 'flagged — reconnect with an office account' },
  ],
  Communication: [
    { field: 'activeMeetings', key: 'meetings', label: 'Meetings they host', icon: 'videocam-outline', withSuccessor: 'move to {name}', withoutSuccessor: 'cancelled' },
    { field: 'scheduledMeetingsAsParticipant', key: 'meetingInvites', label: 'Meetings they\'re invited to', icon: 'videocam-outline', withSuccessor: 'removed from them', withoutSuccessor: 'removed from them' },
    { field: 'clientChats', key: 'clientChats', label: 'Client chats', icon: 'chatbubbles-outline', withSuccessor: 'continue with {name}', withoutSuccessor: 'continue with an admin' },
    { field: 'groupsOwned', key: 'groups', label: 'Chat groups they own', icon: 'chatbubble-ellipses-outline', withSuccessor: 'next member takes over', withoutSuccessor: 'next member takes over' },
    { field: 'openSupportTickets', key: 'tickets', label: 'Open support tickets', icon: 'headset-outline', withSuccessor: 'move to {name}', withoutSuccessor: 'move to an admin' },
  ],
  Signature: [
    { field: 'pendingPreparerSignatures', key: 'preparerSignatures', label: 'Sent requests waiting for their preparer signature', icon: 'create-outline', withSuccessor: '{name} becomes the preparer if eligible', withoutSuccessor: 'admins are asked to pick a preparer' },
    { field: 'preparerOnDrafts', key: 'preparerDrafts', label: 'Draft requests with them as preparer', icon: 'document-outline', withSuccessor: 'preparer cleared — the author picks one', withoutSuccessor: 'preparer cleared — the author picks one' },
    { field: 'draftRequests', key: 'signatureDrafts', label: 'Signature requests they were drafting', icon: 'documents-outline', withSuccessor: 'move to {name}', withoutSuccessor: 'discarded (scheduled ones are kept)' },
  ],
  Campaigns: [
    { field: 'activeSchedules', key: 'campaignSchedules', label: 'Scheduled campaigns', icon: 'megaphone-outline', withSuccessor: 'move to {name} if they can send campaigns', withoutSuccessor: 'paused — admins are notified' },
  ],
  Tenant: [
    { field: 'isSecurityCoordinator', key: 'wispCoordinator', label: 'Security coordinator (WISP)', icon: 'shield-outline', withSuccessor: 'role cleared — choose a new coordinator', withoutSuccessor: 'role cleared — choose a new coordinator' },
  ],
};

/** Renglón cuando no se pudo saber qué servicios participan: el diálogo avisa en vez de decir "nada". */
const UNKNOWN_IMPACT: OffboardImpactItem = {
  key: 'participants',
  label: 'Impact preview',
  icon: 'alert-circle-outline',
  withSuccessor: '',
  withoutSuccessor: '',
  count: 0,
  available: false,
};

/**
 * Datos del retiro de un empleado: la preview de impacto (antes) y el avance del handover (después). Vive
 * aparte de `UserManagementService` (que el shell ya carga por el banner de asientos) para que el texto de
 * los renglones solo llegue con el módulo de usuarios, no en el bundle inicial.
 */
@Injectable({ providedIn: 'root' })
export class OffboardImpactService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  /**
   * Preview de impacto: Auth dice qué servicios tienen pre-flight y se pide a cada uno. Cada llamada degrada
   * sola (available:false) para que un servicio caído no tumbe toda la preview.
   */
  getOffboardImpact(userId: string, email: string): Observable<OffboardImpactItem[]> {
    return this.getParticipants().pipe(
      switchMap(participants =>
        participants.length === 0
          ? of([[UNKNOWN_IMPACT]])
          : forkJoin(participants.map(participant => this.impactOf(participant, userId, email))),
      ),
      map(groups => groups.flat()),
      catchError(() => of([UNKNOWN_IMPACT])),
    );
  }

  /** Avance del handover: cuántas áreas confirmaron su parte. 404 = retiro anterior al seguimiento. */
  getStatus(userId: string): Observable<OffboardingStatus> {
    return this.http.get<OffboardingStatus>(this.api.tenantUrl(`/auth/users/${userId}/offboarding-status`));
  }

  private getParticipants(): Observable<OffboardingParticipant[]> {
    return this.http.get<OffboardingParticipant[]>(this.api.tenantUrl('/auth/offboarding/participants'));
  }

  private impactOf(participant: OffboardingParticipant, userId: string, email: string): Observable<OffboardImpactItem[]> {
    const fields = IMPACT_COPY[participant.service];
    return this.impactRequest(participant, userId, email).pipe(
      map(response =>
        fields
          ? fields.map(field => toImpactItem(field, countOf(response[field.field]), true))
          : [genericItem(participant, response, true)],
      ),
      catchError(() =>
        of(fields ? fields.map(field => toImpactItem(field, 0, false)) : [genericItem(participant, {}, false)]),
      ),
    );
  }

  /** Con email: POST con el email en el cuerpo (en la URL quedaría en los logs). Sin él: GET. */
  private impactRequest(participant: OffboardingParticipant, userId: string, email: string): Observable<ImpactResponse> {
    const url = this.api.tenantUrl(participant.impactPath.replace('{userId}', encodeURIComponent(userId)));
    return participant.acceptsEmail && email
      ? this.http.post<ImpactResponse>(url, { email })
      : this.http.get<ImpactResponse>(url);
  }
}

/** Un número o un booleano (p. ej. "es el coordinador del WISP") como conteo; lo que falte es 0. */
function countOf(value: number | boolean | undefined): number {
  return typeof value === 'boolean' ? (value ? 1 : 0) : (value ?? 0);
}

function toImpactItem(field: ImpactField, count: number, available: boolean): OffboardImpactItem {
  return {
    key: field.key,
    label: field.label,
    icon: field.icon,
    withSuccessor: field.withSuccessor,
    withoutSuccessor: field.withoutSuccessor,
    count,
    available,
  };
}

/**
 * Servicio sin texto propio todavía: un renglón con el área y el mayor de sus conteos (no se suman: un
 * servicio puede mandar un total junto a su desglose y sumar contaría dos veces).
 */
function genericItem(participant: OffboardingParticipant, response: ImpactResponse, available: boolean): OffboardImpactItem {
  const count = Math.max(0, ...Object.values(response).map(countOf));
  return {
    key: `service:${participant.service}`,
    label: `item${count === 1 ? '' : 's'} in ${participant.module}`,
    icon: 'list-outline',
    withSuccessor: 'handed over automatically',
    withoutSuccessor: 'handed over automatically',
    count,
    available,
  };
}
