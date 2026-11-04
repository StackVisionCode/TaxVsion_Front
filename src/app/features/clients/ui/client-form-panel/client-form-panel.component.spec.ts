import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { OfficeLanguage, OfficeLanguageStore } from '@core/services/office-language.store';
import { ClientPermissions } from '../../data-access/client-permissions';
import { ClientsService } from '../../data-access/clients.service';
import { ClientsStore } from '../../data-access/clients.store';
import { ClientItem } from '../client-table/client-table.component';
import { ClientFormPanelComponent } from './client-form-panel.component';

/** Promesa que el test resuelve cuando quiere, para simular la respuesta del perfil. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const existing = {
  id: 'c1',
  type: 'individual',
  displayName: 'Ana Pérez',
  email: 'ana@example.com',
  phone: '',
  isActive: true,
} as unknown as ClientItem;

describe('ClientFormPanelComponent — idioma predeterminado de la oficina', () => {
  function setup(lastKnown: OfficeLanguage = 'en') {
    const profile = deferred<OfficeLanguage>();
    const officeLanguage = {
      language: signal<OfficeLanguage>(lastKnown),
      refresh: vi.fn(() => profile.promise),
    };
    const getById = vi.fn(() =>
      of({ language: 'Fr', preferredChannel: 'Email', kind: 'Individual' }),
    );
    TestBed.configureTestingModule({
      imports: [ClientFormPanelComponent],
      providers: [
        provideRouter([]),
        { provide: OfficeLanguageStore, useValue: officeLanguage },
        { provide: ClientsStore, useValue: { partialSaveWarning: signal(null), getById } },
        {
          provide: ClientPermissions,
          useValue: { canSetFiscalProfile: signal(true), canChangeStatus: signal(true) },
        },
        { provide: ClientsService, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(ClientFormPanelComponent);
    const component = fixture.componentInstance;
    const open = (client: ClientItem | null = null) => {
      fixture.componentRef.setInput('client', client);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();
    };
    return { fixture, component, open, profile, officeLanguage, getById };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('preselecciona español cuando la oficina tiene `es`', async () => {
    const { component, open, profile, officeLanguage } = setup();
    open();
    expect(officeLanguage.refresh).toHaveBeenCalledTimes(1);
    expect(component.language()).toBe('En');

    profile.resolve('es');
    await profile.promise;

    expect(component.language()).toBe('Es');
  });

  it('usa el último idioma conocido mientras llega el perfil', () => {
    const { component, open } = setup('es');
    open();

    expect(component.language()).toBe('Es');
  });

  it('sin perfil o con error queda inglés (el store resuelve con el fallback)', async () => {
    const { component, open, profile } = setup();
    open();
    profile.resolve('en');
    await profile.promise;

    expect(component.language()).toBe('En');
  });

  it('no pisa el idioma que el usuario ya eligió', async () => {
    const { fixture, component, open, profile } = setup();
    open();
    fixture.detectChanges();

    const select = document.body.querySelector('select[name="language"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    select.value = 'Fr';
    select.dispatchEvent(new Event('change'));
    expect(component.language()).toBe('Fr');

    profile.resolve('es');
    await profile.promise;

    expect(component.language()).toBe('Fr');
    fixture.destroy();
  });

  it('en edición no pide el perfil ni cambia el idioma del cliente', async () => {
    const { component, open, officeLanguage, getById } = setup('es');
    open(existing);

    expect(officeLanguage.refresh).not.toHaveBeenCalled();
    expect(getById).toHaveBeenCalledWith('c1');
    expect(component.language()).toBe('Fr');
  });

  it('descarta la respuesta de una apertura anterior', async () => {
    const { fixture, component, open, profile } = setup();
    open();
    // Se cierra y se abre en edición antes de que llegue el perfil del alta.
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    open(existing);

    profile.resolve('es');
    await profile.promise;

    expect(component.language()).toBe('Fr');
  });
});
