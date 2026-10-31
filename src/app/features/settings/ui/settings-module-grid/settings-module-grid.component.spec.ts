import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { FEATURES } from '@core/access/features';
import { SETTINGS_MODULES, SettingsModuleGridComponent } from './settings-module-grid.component';

/**
 * B3 — la grilla de Settings también sale del registro. Una tarjeta para configurar la firma
 * cuando la oficina no contrató firmas es una puerta pintada en la pared: se puede abrir, y detrás
 * hay un 403.
 */
describe('SettingsModuleGridComponent', () => {
  function create(allowed: readonly string[]) {
    TestBed.configureTestingModule({
      imports: [SettingsModuleGridComponent],
      providers: [
        provideRouter([]),
        { provide: AccessStore, useValue: { canUseId: (id?: string) => !id || allowed.includes(id) } },
      ],
    });
    const fixture = TestBed.createComponent(SettingsModuleGridComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('Overview no depende de ningún módulo', () => {
    const fixture = create([]);

    // Las preferencias personales (Notifications, Communication preferences) son autoservicio: siempre se ven.
    expect(fixture.componentInstance.modules().map(m => m.id)).toEqual(['overview', 'notifications', 'communication-preferences']);
  });

  it('muestra solo las tarjetas de los módulos que el usuario tiene', () => {
    // La tarjeta de firma depende de signature-settings (ajustes globales), no del módulo de firmas.
    const fixture = create(['signature-settings', 'documents']);

    expect(fixture.componentInstance.modules().map(m => m.id)).toEqual([
      'overview',
      'documents',
      'notifications',
      'signature',
      'communication-preferences',
    ]);
  });

  // F9 (ADD-10 §14.1): la gobernanza de Communication pide `communication.settings.manage` (no basta usar el chat
  // o unirse a reuniones); las preferencias personales se ven siempre.
  it('sin communication.settings.manage no hay tarjetas de Communication, solo las preferencias personales', () => {
    const fixture = create(['clients', 'email', 'chat', 'meetings']);
    const ids = fixture.componentInstance.modules().map(m => m.id);

    expect(ids).toContain('mail');
    expect(ids).toContain('communication-preferences');
    for (const id of ['communication-chat', 'communication-meetings', 'communication-calls', 'communication-recording']) {
      expect(ids).not.toContain(id);
    }
  });

  it('quien administra ve Chat, Meetings, Calls y Recording; el panel muerto "Meetings" ya no existe', () => {
    const fixture = create([
      'communication-settings-chat',
      'communication-settings-meetings',
      'communication-settings-calls',
      'communication-settings-recording',
    ]);
    const ids = fixture.componentInstance.modules().map(m => m.id);

    expect(ids).toEqual(expect.arrayContaining(['communication-chat', 'communication-meetings', 'communication-calls', 'communication-recording']));
    expect(ids).not.toContain('meetings');
  });

  it('toda tarjeta con featureId apunta a una feature del registro', () => {
    const ids = new Set(FEATURES.map(feature => feature.id));

    for (const module of SETTINGS_MODULES) {
      if (module.featureId) {
        expect(ids.has(module.featureId), `featureId desconocido: ${module.featureId}`).toBe(true);
      }
    }
  });
});
