import { describe, expect, it } from 'vitest';
import {
  notificationActionLabel,
  notificationActorInitials,
  notificationResourceLabel,
  notificationText,
  resolveNotificationLocale,
} from './notification-i18n';

describe('notificationText', () => {
  it('renders catalog keys and parameters in English and Spanish', () => {
    const payload = {
      title: 'Fallback title',
      body: 'Fallback body',
      titleKey: 'notif.connectors.oauth.refresh_failed.title',
      bodyKey: 'notif.connectors.oauth.refresh_failed.body',
      params: { providerCode: 'Google' },
    };

    expect(notificationText(payload, 'en')).toEqual({
      title: 'Reconnect Google',
      body: 'Access to the Google mailbox could not be renewed.',
    });
    expect(notificationText(payload, 'es')).toEqual({
      title: 'Reconecta Google',
      body: 'No se pudo renovar el acceso al buzon de Google.',
    });
  });

  it('uses backend fallback copy for unknown keys', () => {
    expect(
      notificationText(
        {
          title: 'Fallback title',
          body: 'Fallback body',
          titleKey: 'notif.unknown.title',
          bodyKey: 'notif.unknown.body',
          params: {},
        },
        'en',
      ),
    ).toEqual({ title: 'Fallback title', body: 'Fallback body' });
  });

  it('cae en el catalogo por `kind` cuando no vienen titleKey/bodyKey', () => {
    // El backend no envio claves pero el kind esta en el catalogo: debe traducir, no mostrar el fallback crudo.
    expect(
      notificationText(
        {
          title: 'Fallback title',
          body: 'Fallback body',
          titleKey: null,
          bodyKey: null,
          params: {},
          kind: 'tasks.task_overdue',
        },
        'es',
      ),
    ).toEqual({ title: 'Tarea vencida', body: 'Una tarea asignada esta vencida.' });
  });

  it('no re-interpola el fallback del backend (literales {foo} se preservan)', () => {
    // El servidor ya expande params; si por alguna razon llega un literal no mapeable, no lo borramos.
    expect(
      notificationText(
        {
          title: 'Overdue: {task}',
          body: 'See {missing} for details',
          titleKey: null,
          bodyKey: null,
          params: { task: 'Pay invoice' },
          kind: 'unknown.kind',
        },
        'en',
      ),
    ).toEqual({ title: 'Overdue: {task}', body: 'See {missing} for details' });
  });
});

describe('resolveNotificationLocale', () => {
  it('la eleccion explicita del usuario manda sobre navigator', () => {
    expect(resolveNotificationLocale('en')).toBe('en');
    expect(resolveNotificationLocale('es-MX')).toBe('es');
  });

  it('sin eleccion explicita el default es `en`', () => {
    // En jsdom navigator.languages suele traer en-US; aun asi el default siempre es en salvo navegador en es.
    expect(resolveNotificationLocale(null)).toBe('en');
  });
});

describe('notificationActionLabel', () => {
  it('traduce los 5 verbos del catalogo backend a labels EN/ES', () => {
    expect(notificationActionLabel('open', 'en')).toBe('Open');
    expect(notificationActionLabel('review', 'es')).toBe('Revisar');
    expect(notificationActionLabel('sign', 'en')).toBe('Sign');
    expect(notificationActionLabel('pay', 'es')).toBe('Pagar');
    expect(notificationActionLabel('reconnect', 'en')).toBe('Reconnect');
  });

  it('devuelve null para action nulo o desconocido — el caller decide el fallback', () => {
    expect(notificationActionLabel(null, 'en')).toBeNull();
    expect(notificationActionLabel(undefined, 'en')).toBeNull();
    expect(notificationActionLabel('unknown_verb', 'en')).toBeNull();
  });
});

describe('notificationActorInitials', () => {
  it('devuelve las iniciales de las primeras dos palabras', () => {
    expect(notificationActorInitials('Juan Pérez')).toBe('JP');
    expect(notificationActorInitials('ADMIN')).toBe('A');
    expect(notificationActorInitials('  maría josé  ')).toBe('MJ');
  });

  it('ignora acentos y descarta caracteres no latinos (deja al caller caer al icono por tipo)', () => {
    expect(notificationActorInitials('李')).toBeNull();
    expect(notificationActorInitials('')).toBeNull();
    expect(notificationActorInitials(null)).toBeNull();
    expect(notificationActorInitials(undefined)).toBeNull();
  });

  it('solo toma la primera letra de hasta las dos primeras palabras', () => {
    expect(notificationActorInitials('María Elena de Castro')).toBe('ME');
  });
});

describe('notificationResourceLabel', () => {
  it('mapea resourceType conocido a label legible EN/ES', () => {
    expect(notificationResourceLabel('signature_request', 'en')).toBe('Signature request');
    expect(notificationResourceLabel('mailbox', 'es')).toBe('Buzón');
    expect(notificationResourceLabel('import_job', 'en')).toBe('Import job');
  });

  it('devuelve el valor original para resourceType no mapeado — pista utilizable sin tocar la UI', () => {
    expect(notificationResourceLabel('future_type', 'en')).toBe('future_type');
  });

  it('devuelve null para resourceType ausente', () => {
    expect(notificationResourceLabel(null)).toBeNull();
    expect(notificationResourceLabel(undefined)).toBeNull();
  });
});
