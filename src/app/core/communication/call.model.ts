/**
 * Tipos de llamadas 1:1 (audio/video, WebRTC mesh) — espejo de
 * `contracts/socket/call-socket-events.ts` del backend Communication. El server
 * solo señaliza (relay SDP/ICE opaco); el RTCPeerConnection vive en ActiveCallService.
 */

export type CallKind = 'Audio' | 'Video';

export type CallConnectionQuality = 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Disconnected';

export type CallStatus =
  | 'Ringing'
  | 'Accepted'
  | 'Active'
  | 'Ended'
  | 'Rejected'
  | 'Cancelled'
  | 'MissedCall'
  | 'Failed';

/** Fila de GET /communication/webrtc/ice. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceResponse {
  iceServers: IceServer[];
  expiresAtUtc: string;
}

export interface IncomingCallDto {
  callId: string;
  callerUserId: string;
  callerDisplayName: string;
  calleeUserId: string;
  kind: CallKind;
  conversationId: string | null;
  ringingAtUtc: string;
}

export interface CallStateDto {
  callId: string;
  status: CallStatus;
  endReason: 'Hangup' | 'Missed' | 'Rejected' | 'Cancelled' | 'IceFailed' | null;
  durationSeconds: number | null;
  updatedAtUtc: string;
}

export interface CallPeerDto {
  callId: string;
  peerUserId: string;
  displayName: string;
  role: 'Caller' | 'Callee';
  joinOrder: number;
  isPolite: boolean;
}

export interface CallSignalDto {
  callId: string;
  fromPeerUserId: string;
  kind: 'offer' | 'answer' | 'ice';
  data: Record<string, unknown>;
}

export interface CallMediaStatusDto {
  callId: string;
  peerUserId: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
}

export interface CallUpgradedToVideoDto {
  callId: string;
  upgradedByUserId: string;
  upgradedAtUtc: string;
}

export type CallRecordingState =
  | 'Idle'
  | 'Requesting'
  | 'Recording'
  | 'Stopping'
  | 'Processing'
  | 'Ready'
  | 'Failed';

export interface CallRecordingConsentRequestedDto {
  callId: string;
  requestedByUserId: string;
  requestedAtUtc: string;
}

export interface CallRecordingConsentRecordedDto {
  callId: string;
  userId: string;
  response: 'Accepted' | 'Rejected';
  respondedAtUtc: string;
}

export interface CallRecordingStateChangedDto {
  callId: string;
  state: CallRecordingState;
  updatedAtUtc: string;
}

export interface CallTranscriptReadyDto {
  callId: string;
  transcriptFileId: string;
  detectedLanguage: string | null;
  durationSeconds: number;
  wordCount: number;
  readyAtUtc: string;
}

/** Fila de GET /communication/customers/{customerId}/calls — historial de llamadas del cliente con la oficina. */
export interface CustomerCallItem {
  id: string;
  kind: CallKind;
  status: CallStatus;
  /** Relativa a la oficina: 'outgoing' = oficina→cliente, 'incoming' = cliente→oficina. */
  direction: 'incoming' | 'outgoing';
  conversationId: string | null;
  ringingAtUtc: string;
  endedAtUtc: string | null;
  durationSeconds: number | null;
  recordingFileId: string | null;
  endReason: string | null;
}

export interface CustomerCallsStats {
  total: number;
  completed: number;
  missed: number;
  avgDurationSeconds: number | null;
}

export interface CustomerCallsResponse {
  items: CustomerCallItem[];
  stats: CustomerCallsStats;
  /** El cliente tiene cuenta de portal (identidad in-app) → se pueden tener/registrar llamadas. */
  hasPortalAccount: boolean;
  /** UserId del portal del cliente — para iniciar una llamada desde el perfil. Ausente si no hay cuenta. */
  clientUserId?: string;
}
