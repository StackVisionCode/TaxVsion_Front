import { Routes } from '@angular/router';
import { accessCanMatch } from '@core/access/access.guard';
import { CommunicationSettingsStore } from './data-access/communication-settings.store';
import { CommunicationSettingsShellComponent } from './components/communication-settings-shell/communication-settings-shell.component';
import { ChatSettingsPageComponent } from './components/chat-settings-page/chat-settings-page.component';
import { MeetingsSettingsPageComponent } from './components/meetings-settings-page/meetings-settings-page.component';
import { CallsSettingsPageComponent } from './components/calls-settings-page/calls-settings-page.component';
import { RecordingSettingsPageComponent } from './components/recording-settings-page/recording-settings-page.component';

/**
 * F9 — `settings/communication/*`. El store vive en la ruta padre: las cuatro páginas comparten el borrador y
 * se destruye al salir de la sección. Cada hija exige su feature (gobernanza + módulo del plan).
 */
export const COMMUNICATION_SETTINGS_ROUTES: Routes = [
  {
    path: '',
    component: CommunicationSettingsShellComponent,
    providers: [CommunicationSettingsStore],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'chat' },
      { path: 'chat', canMatch: [accessCanMatch], data: { feature: 'communication-settings-chat' }, component: ChatSettingsPageComponent, title: 'Chat settings' },
      { path: 'meetings', canMatch: [accessCanMatch], data: { feature: 'communication-settings-meetings' }, component: MeetingsSettingsPageComponent, title: 'Meeting settings' },
      { path: 'calls', canMatch: [accessCanMatch], data: { feature: 'communication-settings-calls' }, component: CallsSettingsPageComponent, title: 'Call settings' },
      { path: 'recording', canMatch: [accessCanMatch], data: { feature: 'communication-settings-recording' }, component: RecordingSettingsPageComponent, title: 'Recording and transcript settings' },
    ],
  },
];
