/** Páginas de Settings → Communication: una por tarjeta de la grilla (D-38), cada una con su feature del registro. */
export interface CommunicationSettingsPage {
  readonly path: 'chat' | 'meetings' | 'calls' | 'recording';
  readonly featureId: string;
  readonly title: string;
  readonly icon: string;
}

export const COMMUNICATION_SETTINGS_PAGES: readonly CommunicationSettingsPage[] = [
  { path: 'chat', featureId: 'communication-settings-chat', title: 'Chat', icon: 'chatbubbles-outline' },
  { path: 'meetings', featureId: 'communication-settings-meetings', title: 'Meetings', icon: 'videocam-outline' },
  { path: 'calls', featureId: 'communication-settings-calls', title: 'Calls', icon: 'call-outline' },
  { path: 'recording', featureId: 'communication-settings-recording', title: 'Recording & transcript', icon: 'radio-button-on-outline' },
];
