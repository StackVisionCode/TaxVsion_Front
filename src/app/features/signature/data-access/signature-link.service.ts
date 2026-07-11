import { Injectable } from '@angular/core';
import { SignatureRequest, Signer } from '../ui/signature-table/signature-table.component';
import { defaultRules } from '../ui/signature-request-panel/signature-wizard.mock';

export interface SigningLink {
  token: string;
  signer: Signer;
  /** Ruta interna del enlace de firma (mock de firma.taxvision.app/s/<token>). */
  url: string;
}

export interface SigningContext {
  request: SignatureRequest;
  signer: Signer;
  /** true cuando el token no existía y se sirvió la solicitud demo. */
  isDemo: boolean;
}

/** Solicitud demo para abrir /sign/<token> directo (o tras recargar, al perderse el registro en memoria). */
function demoContext(): SigningContext {
  const signer: Signer = {
    name: 'Maria Gonzalez',
    initials: 'MG',
    email: 'maria.gonzalez@email.com',
    color: 'bg-indigo-500',
    status: 'pending',
    signedAt: null,
    channel: 'email',
  };
  const request: SignatureRequest = {
    id: 'signature-demo',
    documentName: 'Engagement Letter.pdf',
    client: 'Maria Gonzalez',
    clientId: 'client-1',
    signers: [
      signer,
      { name: 'Jose Gonzalez', initials: 'JG', email: 'jose.gonzalez@email.com', color: 'bg-orange-500', status: 'pending', signedAt: null, channel: 'sms' },
    ],
    status: 'pending',
    sentDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    completedDate: null,
    notes: '',
    rules: defaultRules(),
  };
  return { request, signer, isDemo: true };
}

/**
 * Registro en memoria de enlaces de firma (mock). Al enviar una solicitud, la
 * página registra un token por firmante y muestra los enlaces; /sign/:token los
 * resuelve. Sin backend: si el token no existe (recarga, enlace inventado) se
 * sirve una solicitud demo para poder recorrer la experiencia igualmente.
 */
@Injectable({ providedIn: 'root' })
export class SignatureLinkService {
  private readonly links = new Map<string, SigningContext>();

  /** Genera un token por firmante y los registra; devuelve los enlaces para el modal. */
  register(request: SignatureRequest): SigningLink[] {
    return request.signers.map(signer => {
      const token = Math.random().toString(36).slice(2, 10);
      this.links.set(token, { request, signer, isDemo: false });
      return { token, signer, url: `/sign/${token}` };
    });
  }

  resolve(token: string): SigningContext {
    return this.links.get(token) ?? demoContext();
  }
}
