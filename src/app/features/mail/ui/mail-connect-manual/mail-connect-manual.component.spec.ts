import { SimpleChange } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { MailConnectManualComponent } from './mail-connect-manual.component';
import { ConnectManualAccountRequest, TestManualConnectionResult } from '../../data-access/mail.model';
import { detectProvider } from '../../data-access/mail-provider-detect.util';

/** Formulario manual del asistente: lo común a la vista, la prueba ligada a los datos probados. */
describe('MailConnectManualComponent', () => {
  function open(loginEmail = 'ana@yahoo.com', asOffice = false): MailConnectManualComponent {
    const component = new MailConnectManualComponent();
    component.loginEmail = loginEmail;
    component.asOffice = asOffice;
    component.preset = detectProvider(loginEmail).imapPreset;
    component.ngOnChanges({
      preset: new SimpleChange(null, component.preset, true),
      asOffice: new SimpleChange(null, asOffice, true),
      loginEmail: new SimpleChange(null, loginEmail, true),
    });
    return component;
  }

  const passed: TestManualConnectionResult = {
    imap: { ok: true, errorCode: null, message: null },
    smtp: { ok: true, errorCode: null, message: null },
  };

  it('con un proveedor conocido solo pide la contraseña: los servidores quedan prellenados y plegados', () => {
    const component = open();

    expect(component.showAdvanced).toBe(false);
    expect(component.imapHost).toBe('imap.mail.yahoo.com');
    expect(component.isValid).toBe(false);

    component.password = 'app-password';

    expect(component.isValid).toBe(true);
  });

  it('sin proveedor conocido abre Advanced settings para completar los servidores', () => {
    const component = open('ana@myfirm.com');

    expect(component.showAdvanced).toBe(true);
    expect(component.missingServers).toBe(true);
  });

  it('la misma contraseña entra y envía salvo que se pidan credenciales distintas', () => {
    const component = open();
    const emitted = vi.fn<(request: ConnectManualAccountRequest) => void>();
    component.submitConnect.subscribe(emitted);
    component.password = 'app-password';

    component.onSubmit();
    expect(emitted.mock.calls[0][0]).toMatchObject({
      imapUsername: 'ana@yahoo.com',
      imapPassword: 'app-password',
      smtpUsername: 'ana@yahoo.com',
      smtpPassword: 'app-password',
    });

    component.separateSmtpCredentials = true;
    component.smtpPassword = 'other';
    component.onSubmit();
    expect(emitted.mock.calls[1][0]).toMatchObject({ imapPassword: 'app-password', smtpPassword: 'other' });
  });

  it('el resultado de la prueba se deja de mostrar si cambia un dato de la conexión', () => {
    const component = open();
    component.password = 'app-password';
    component.onTest();
    component.testResult = passed;

    expect(component.testPassed).toBe(true);
    expect(component.testRows.map(row => row.label)).toEqual(['Incoming mail (IMAP)', 'Outgoing mail (SMTP)']);

    component.displayName = 'Front desk'; // no afecta a la conexión
    expect(component.testPassed).toBe(true);

    component.password = 'typo';
    expect(component.testRows).toEqual([]);
  });

  it('un fallo de contraseña en Yahoo explica la app password con el enlace oficial', () => {
    const component = open();
    component.password = 'regular-password';
    component.onTest();
    component.testResult = {
      imap: {
        ok: false,
        errorCode: 'ManualAccountConnectivityValidator.ImapAuthFailed',
        message: 'The IMAP server rejected the username or password.',
      },
      smtp: passed.smtp,
    };

    const [imap] = component.testRows;
    expect(imap.guidance?.text).toContain('app password');
    expect(imap.guidance?.link?.url).toBe('https://help.yahoo.com/kb/SLN15241.html');
  });

  it('oficina: email y usuario editables; el usuario vacío cae al email', () => {
    const component = open('admin@myfirm.com', true);
    const emitted = vi.fn<(request: ConnectManualAccountRequest) => void>();
    component.submitConnect.subscribe(emitted);
    component.emailAddress = 'office@myfirm.com';
    component.password = 'secret';

    component.onSubmit();

    expect(component.selectedProviderId).toBe('office365');
    expect(emitted.mock.calls[0][0]).toMatchObject({
      emailAddress: 'office@myfirm.com',
      imapUsername: 'office@myfirm.com',
      asOffice: true,
    });
  });
});
