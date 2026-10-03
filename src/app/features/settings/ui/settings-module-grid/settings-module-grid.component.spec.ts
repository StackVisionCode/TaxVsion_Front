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

    expect(fixture.componentInstance.modules().map(m => m.id)).toEqual(['overview']);
  });

  it('muestra solo las tarjetas de los módulos que el usuario tiene', () => {
    const fixture = create(['signature', 'documents']);

    expect(fixture.componentInstance.modules().map(m => m.id)).toEqual([
      'overview',
      'documents',
      'signature',
    ]);
  });

  it('sin el módulo de comunicación no queda la tarjeta de Meetings', () => {
    const fixture = create(['clients', 'email']);
    const ids = fixture.componentInstance.modules().map(m => m.id);

    expect(ids).toContain('mail');
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
