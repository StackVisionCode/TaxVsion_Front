/**
 * F9 — contrato de `GET/PUT /communication/settings` (configuración de Communication de la oficina).
 * Espejo de `TenantCommunicationSettingsSnapshot`, `TenantCommunicationLimitsSnapshot` y la parte de
 * `EffectiveCommunicationSettings` que muestran las páginas. Los campos `null` heredan la plataforma.
 */

export type RecordingConsentPolicy = 'AllAcceptedRequired' | 'NoRejections' | 'HostOverride';
export type MeetingSoundsPolicy = 'all' | 'hostOnly' | 'off';

export interface CommunicationOfficeSettings {
  chatEnabled: boolean;
  callsEnabled: boolean;
  videoCallsEnabled: boolean;
  meetingsEnabled: boolean;
  supportEnabled: boolean;
  /** En el backend se llama así, pero decide si el chat acepta adjuntos. */
  screenshotsEnabled: boolean;
  employeeToEmployeeChatEnabled: boolean;
  restrictCustomerChatToAssignedPreparer: boolean;
  groupsAllowMultipleClients: boolean;
  defaultCameraOff: boolean;
  defaultMicrophoneOff: boolean;
  persistChatOnEnd: boolean;
  messageRetentionDays: number;
  recordingRetentionDays: number;
  purgeEnabled: boolean;
  recordingConsentPolicy: RecordingConsentPolicy;
  defaultMeetingDurationMinutes: number | null;
  maxMeetingDurationMinutes: number | null;
  maxMeetingParticipants: number | null;
  maxRecordingMinutesMeeting: number | null;
  maxRecordingMinutesAudioCall: number | null;
  maxRecordingMinutesVideoCall: number | null;
  ringingTimeoutSeconds: number | null;
  meetingChatAttachmentsPerMinute: number | null;
  meetingChatAttachmentsPerMeeting: number | null;
  meetingSoundsPolicy: MeetingSoundsPolicy | null;
  transcriptLanguage: string | null;
  recordingVisibleInPortal: boolean;
  guestsAllowed: boolean;
  clientsCanShareScreen: boolean | null;
  screenAudioAllowed: boolean | null;
  audioEchoCancellationDefault: boolean | null;
  audioNoiseSuppressionDefault: boolean | null;
  audioAutoGainControlDefault: boolean | null;
  echoMuteOnDetect: boolean | null;
  reactionsEnabled: boolean | null;
  meetingReminderMinutesBefore: number | null;
  guestsWaitingRoom: boolean | null;
  transcriptPrompt: string | null;
  voiceNoteTranscriptEnabled: boolean | null;
  chatEditWindowMinutesDirect: number | null;
  chatEditWindowMinutesGroup: number | null;
  chatEditWindowMinutesSupport: number | null;
  chatEditWindowMinutesMeeting: number | null;
  chatMaxEditsPerMessage: number | null;
}

export type CommunicationSettingsKey = keyof CommunicationOfficeSettings;
export type CommunicationSettingsPatch = Partial<CommunicationOfficeSettings>;

/** Techos efectivos (técnico ∩ plataforma ∩ plan ∩ techo de la oficina): ningún valor puede superarlos. */
export interface CommunicationCeilings {
  maxParticipants: number;
  maxMeetingDurationMinutes: number;
  maxRecordingMinutesMeeting: number;
  maxRecordingMinutesAudioCall: number;
  maxRecordingMinutesVideoCall: number;
  meetingChatAttachmentsPerMinute: number;
  meetingChatAttachmentsPerMeeting: number;
  chatEditWindowMinutesDirect: number;
  chatEditWindowMinutesGroup: number;
  chatEditWindowMinutesSupport: number;
  chatEditWindowMinutesMeeting: number;
  chatMaxEditsPerMessage: number;
  recordingAllowed: boolean;
  recordingVideoAllowed: boolean;
  transcriptAllowed: boolean;
  callsAllowed: boolean;
  supportAllowed: boolean;
  guestsAllowed: boolean;
}

/** Valores vigentes: lo que de verdad aplica (el valor de la oficina o, si es null, el de la plataforma). */
export interface CommunicationEffective {
  planCode: string | null;
  ceilings: CommunicationCeilings;
  meeting: {
    maxDurationMinutes: number;
    defaultDurationMinutes: number;
    maxParticipants: number;
    guestsWaitingRoom: boolean;
    reminderMinutesBefore: number;
    soundsPolicy: MeetingSoundsPolicy;
    chatAttachmentsPerMinute: number;
    chatAttachmentsPerMeeting: number;
  };
  calls: {
    ringingTimeoutSeconds: number;
    maxCallMinutes: number | null;
    maxConcurrentCalls: number | null;
    maxMonthlyMinutes: number | null;
  };
  recording: {
    maxMinutesMeeting: number;
    maxMinutesAudioCall: number;
    maxMinutesVideoCall: number;
    transcriptLanguage: string;
    voiceNote: { enabled: boolean };
  };
  chat: {
    edit: { windowMinutes: Record<'Direct' | 'Group' | 'Support' | 'Meeting', number>; maxEdits: number };
  };
  media: {
    audio: { processing: { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean } };
    screenShare: { clientsCanShare: boolean; audioAllowed: boolean };
    echo: { muteOnEcho: boolean };
    reactions: { enabled: boolean };
  };
}

/** Números que edita la oficina; el backend manda el rango técnico de cada uno. */
export type CommunicationNumericKey =
  | 'defaultMeetingDurationMinutes'
  | 'maxMeetingDurationMinutes'
  | 'maxMeetingParticipants'
  | 'maxRecordingMinutesMeeting'
  | 'maxRecordingMinutesAudioCall'
  | 'maxRecordingMinutesVideoCall'
  | 'ringingTimeoutSeconds'
  | 'meetingChatAttachmentsPerMinute'
  | 'meetingChatAttachmentsPerMeeting'
  | 'meetingReminderMinutesBefore'
  | 'chatEditWindowMinutesDirect'
  | 'chatEditWindowMinutesGroup'
  | 'chatEditWindowMinutesSupport'
  | 'chatEditWindowMinutesMeeting'
  | 'chatMaxEditsPerMessage'
  | 'messageRetentionDays'
  | 'recordingRetentionDays';

export interface CommunicationSettingsOverview {
  settings: CommunicationOfficeSettings;
  effective: CommunicationEffective;
  /** Rango técnico de cada número; el máximo real además lo acota el techo de `effective.ceilings`. */
  ranges: Record<CommunicationNumericKey, { min: number; max: number }>;
  transcriptPromptMaxLength: number;
}

/** Idiomas del transcript que ofrece la pantalla; el backend acepta "auto" o cualquier código válido. */
export const TRANSCRIPT_LANGUAGE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'auto', label: 'Detect automatically' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
];

export const RECORDING_CONSENT_OPTIONS: readonly { value: RecordingConsentPolicy; label: string; hint: string }[] = [
  { value: 'NoRejections', label: 'Record unless someone declines', hint: 'Recording starts unless a participant declines.' },
  { value: 'AllAcceptedRequired', label: 'Everyone must accept', hint: 'Recording starts only after every participant accepts.' },
  { value: 'HostOverride', label: 'Host decides', hint: 'The host can record even if someone declines.' },
];

export const MEETING_SOUNDS_OPTIONS: readonly { value: MeetingSoundsPolicy; label: string }[] = [
  { value: 'all', label: 'Everyone hears join and leave sounds' },
  { value: 'hostOnly', label: 'Only the host hears them' },
  { value: 'off', label: 'No join and leave sounds' },
];

/** Claves cuyo cambio no se guardó: lo único que viaja en el PUT. */
export function changedSettings(
  server: CommunicationOfficeSettings,
  draft: CommunicationOfficeSettings,
): CommunicationSettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as CommunicationSettingsKey[]) {
    if (draft[key] !== server[key]) patch[key] = draft[key];
  }
  return patch as CommunicationSettingsPatch;
}

/** Errores del backend en palabras de la oficina (nunca el mensaje técnico con nombres de campos). */
export function settingsErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case 'Settings.AboveCeiling':
      return "One of the values is above your office's limit. Lower it and try again.";
    case 'Settings.InvalidLanguage':
      return 'Choose a valid transcript language.';
    case 'Settings.DefaultAboveMax':
      return "The default meeting length can't be longer than the maximum.";
    case 'Settings.InvalidTranscriptPrompt':
      return 'The transcript vocabulary is too long.';
    case 'Settings.OutOfTechnicalRange':
    case 'Settings.InvalidRetention':
      return 'One of the values is out of range. Check it and try again.';
    default:
      return "Couldn't save the settings. Check the values and try again.";
  }
}
