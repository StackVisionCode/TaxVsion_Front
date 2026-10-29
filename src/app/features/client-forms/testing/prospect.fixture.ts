import type { FormProspect } from '../data-access/client-forms.model';

/** Prospect base para specs: verificado, dirigido y con una request pendiente. */
export function prospect(patch: Partial<FormProspect> = {}): FormProspect {
  return {
    participantId: 'participant-1',
    email: 'pat@example.com',
    fullName: 'Pat Prospect',
    phoneE164: null,
    status: 'Verified',
    source: 'DirectedRequest',
    createdAtUtc: '2026-10-20T10:00:00',
    lastActivityAtUtc: '2026-10-27T15:30:00',
    requestCount: 1,
    latestRequest: {
      id: 'request-1',
      title: 'Organizer 2026',
      status: 'Pending',
      templateName: 'Organizer',
    },
    customerId: null,
    duplicateOfCustomerId: null,
    lostReason: null,
    canCreateClient: false,
    // Como el servidor: hay request de alta solo si se puede crear el cliente.
    createClientRequestId: patch.canCreateClient ? 'request-1' : null,
    ...patch,
  };
}
