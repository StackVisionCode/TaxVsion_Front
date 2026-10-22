import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AccessStore } from '@core/access/access.store';
import { ApiConfigService } from '@core/config/api-config.service';
import { CloudProviderConnectionsComponent } from './cloud-provider-connections.component';

/**
 * El aviso "ya hay un proveedor conectado" sale de las conexiones reales del tenant, no de la lista de
 * proveedores elegibles: con nada conectado salía "OneDrive is connected" al conectar Google Drive.
 */
describe('CloudProviderConnectionsComponent', () => {
  const STORAGE = 'https://api.test/storage';

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: () => STORAGE } },
        // Sin permiso de administración no carga los estados: el test controla cada request.
        { provide: AccessStore, useValue: { isAdmin: () => false, can: () => false } },
      ],
    });
    const component = TestBed.runInInjectionContext(() => new CloudProviderConnectionsComponent());
    return { component, http: TestBed.inject(HttpTestingController) };
  }

  function policy(connectedProviders: string[]) {
    return {
      providerId: 'google-drive',
      availableProviders: ['google-drive', 'onedrive'],
      connectedProviders,
      mode: 'both',
      backupFrequency: null,
      backupTime: null,
      backupTimeZoneId: null,
    };
  }

  it('starts the authorization when no provider is connected, even if others can be selected', () => {
    const { component, http } = setup();
    const googleDrive = component.providers[0];

    component.connect(googleDrive);
    http.expectOne(`${STORAGE}/settings/policy`).flush(policy([]));

    expect(component.pendingSwitch()).toBeNull();
    http.expectOne(`${STORAGE}/providers/google-drive/connect`);
    http.verify();
  });

  it('asks to disconnect only the provider that is really connected', () => {
    const { component, http } = setup();

    component.connect(component.providers[0]);
    http.expectOne(`${STORAGE}/settings/policy`).flush(policy(['dropbox']));

    expect(component.pendingSwitch()?.current.map(provider => provider.id)).toEqual(['dropbox']);
    http.verify();
  });
});
