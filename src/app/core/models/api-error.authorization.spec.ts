import { HttpErrorResponse } from '@angular/common/http';
import { isModuleUnavailable, missingModule, toApiError } from './api-error.model';

/**
 * B1 — el contrato del 403. Hasta A5 los dos motivos llegaban indistinguibles y la UI solo podía
 * mostrar el mismo texto genérico: "no tenés el permiso" y "tu plan no lo incluye" son pantallas
 * distintas (una manda a hablar con el administrador, la otra a mejorar el plan).
 */
describe('403 en RFC 9457', () => {
  function forbidden(body: unknown): HttpErrorResponse {
    return new HttpErrorResponse({ status: 403, error: body });
  }

  it('lee el motivo y el módulo que falta', () => {
    const error = toApiError(
      forbidden({
        code: 'Authz.ModuleUnavailable',
        reason: 'module',
        module: 'comms',
        detail: "Your plan does not include the 'comms' module required for this action.",
      }),
    );

    expect(error.code).toBe('Authz.ModuleUnavailable');
    expect(error.reason).toBe('module');
    expect(error.module).toBe('comms');
  });

  it('distingue la pantalla comercial de la de acceso restringido', () => {
    expect(isModuleUnavailable(forbidden({ code: 'Authz.ModuleUnavailable', reason: 'module', module: 'comms' }))).toBe(
      true,
    );
    expect(isModuleUnavailable(forbidden({ code: 'Authz.PermissionDenied', reason: 'permission' }))).toBe(false);
    expect(missingModule(forbidden({ code: 'Authz.ModuleUnavailable', reason: 'module', module: 'comms' }))).toBe(
      'comms',
    );
    expect(missingModule(forbidden({ code: 'Authz.PermissionDenied', reason: 'permission' }))).toBeNull();
  });

  it('ignora un motivo que no esté en el vocabulario', () => {
    // Si el backend inventa uno nuevo, la UI no debe ramificar por un valor que no entiende.
    expect(toApiError(forbidden({ code: 'Authz.PermissionDenied', reason: 'inventado' })).reason).toBeUndefined();
  });

  it('un 403 sin los campos nuevos sigue funcionando', () => {
    // Un servicio todavía sin desplegar manda el cuerpo viejo: ni se rompe ni se inventa un motivo,
    // y cae del lado conservador (acceso restringido, no pantalla comercial).
    const error = toApiError(forbidden({ code: 'Authz.PermissionDenied', message: 'Forbidden.' }));

    expect(error.message).toBe('Forbidden.');
    expect(error.reason).toBeUndefined();
    expect(isModuleUnavailable(forbidden({ code: 'Authz.PermissionDenied', message: 'Forbidden.' }))).toBe(false);
  });

  it('el mensaje sigue saliendo de `detail` cuando no hay `message`', () => {
    // RFC 9457 llama `detail` a lo que este sistema viene llamando `message`. Las pantallas ya
    // desplegadas leen `message`, así que el fallback tiene que seguir dándoles texto.
    expect(toApiError(forbidden({ code: 'Authz.PermissionDenied', detail: 'No podés hacer esto.' })).message).toBe(
      'No podés hacer esto.',
    );
  });
});
