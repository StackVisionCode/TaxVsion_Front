import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Static placeholder "signed documents" widget for the dashboard. In the
 * production app this aggregated completed e-signature requests from
 * RealTimeSignatureService, cross-referenced with real signed files pulled
 * from cloud storage. Here it's a self-contained mock: a fixed local array
 * of signature requests (a mix of statuses, matching the original filter
 * logic that only surfaces completed ones), a purely-local detail modal,
 * and a simulated file download that generates a small stub blob client
 * side instead of calling a backend.
 */
type SignatureRequestStatus = 'Completed' | 'Pending' | 'InProgress' | 'Rejected' | 'Expired';

interface SignerInfo {
  name: string;
  email: string;
  isCustomer: boolean;
  signedAt?: string;
  customerInfo?: { firstName: string; middleName?: string };
}

interface DocumentInfo {
  fileName: string;
  sizeBytes: number;
  folderName: string;
}

interface SignedDocument {
  id: string;
  status: SignatureRequestStatus;
  createdAt: string;
  completedAt?: string;
  lastActivity: string;
  totalSigners: number;
  signers: SignerInfo[];
  documentInfo: DocumentInfo;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

const MOCK_DOCUMENTS: SignedDocument[] = [
  {
    id: 'doc-1',
    status: 'Completed',
    createdAt: isoDaysAgo(3.2),
    completedAt: isoDaysAgo(3),
    lastActivity: isoDaysAgo(3),
    totalSigners: 2,
    documentInfo: { fileName: '2025_Individual_Tax_Return-signed-J_Smith.pdf', sizeBytes: 842_000, folderName: 'Signed' },
    signers: [
      { name: 'John Smith', email: 'john.smith@example.com', isCustomer: true, signedAt: isoDaysAgo(3), customerInfo: { firstName: 'John', middleName: 'S' } },
      { name: 'Alicia Reyes', email: 'alicia.reyes@taxvision.com', isCustomer: false, signedAt: isoDaysAgo(3) },
    ],
  },
  {
    id: 'doc-2',
    status: 'Completed',
    createdAt: isoDaysAgo(6.5),
    completedAt: isoDaysAgo(6),
    lastActivity: isoDaysAgo(6),
    totalSigners: 1,
    documentInfo: { fileName: 'Engagement_Letter_2026-signed-Acme_Corp.pdf', sizeBytes: 315_000, folderName: 'Signed' },
    signers: [
      { name: 'Linda Park', email: 'linda.park@acmecorp.com', isCustomer: true, signedAt: isoDaysAgo(6), customerInfo: { firstName: 'Linda' } },
    ],
  },
  {
    id: 'doc-3',
    status: 'Completed',
    createdAt: isoDaysAgo(0.3),
    completedAt: isoDaysAgo(0.1),
    lastActivity: isoDaysAgo(0.1),
    totalSigners: 3,
    documentInfo: { fileName: 'W9_Form-signed-Maria_Gonzalez.pdf', sizeBytes: 128_000, folderName: 'Signed' },
    signers: [
      { name: 'Maria Gonzalez', email: 'maria.gonzalez@example.com', isCustomer: true, signedAt: isoDaysAgo(0.1), customerInfo: { firstName: 'Maria', middleName: 'G' } },
      { name: 'Carlos Ibarra', email: 'carlos.ibarra@taxvision.com', isCustomer: false, signedAt: isoDaysAgo(0.15) },
      { name: 'Sophia Lee', email: 'sophia.lee@taxvision.com', isCustomer: false, signedAt: isoDaysAgo(0.2) },
    ],
  },
  {
    id: 'doc-4',
    status: 'Completed',
    createdAt: isoDaysAgo(11),
    completedAt: isoDaysAgo(10),
    lastActivity: isoDaysAgo(10),
    totalSigners: 2,
    documentInfo: { fileName: 'Extension_Request_4868-signed-D_Chen.pdf', sizeBytes: 96_000, folderName: 'Signed' },
    signers: [
      { name: 'David Chen', email: 'david.chen@example.com', isCustomer: true, signedAt: isoDaysAgo(10), customerInfo: { firstName: 'David' } },
      { name: 'Alicia Reyes', email: 'alicia.reyes@taxvision.com', isCustomer: false, signedAt: isoDaysAgo(10) },
    ],
  },
  {
    id: 'doc-5',
    status: 'Completed',
    createdAt: isoDaysAgo(18),
    completedAt: isoDaysAgo(17),
    lastActivity: isoDaysAgo(17),
    totalSigners: 1,
    documentInfo: { fileName: 'POA_Form_2848-signed-Linda_Park.pdf', sizeBytes: 210_000, folderName: 'Signed' },
    signers: [
      { name: 'Linda Park', email: 'linda.park@acmecorp.com', isCustomer: true, signedAt: isoDaysAgo(17), customerInfo: { firstName: 'Linda' } },
    ],
  },
  {
    id: 'doc-6',
    status: 'Pending',
    createdAt: isoDaysAgo(1),
    lastActivity: isoDaysAgo(0.5),
    totalSigners: 1,
    documentInfo: { fileName: '1099_Authorization-Robert_Lee.pdf', sizeBytes: 74_000, folderName: 'Documents' },
    signers: [
      { name: 'Robert Lee', email: 'robert.lee@example.com', isCustomer: true, signedAt: undefined, customerInfo: { firstName: 'Robert' } },
    ],
  },
];

const SIGNER_AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500',
  'bg-pink-500', 'bg-indigo-500', 'bg-teal-500', 'bg-red-500',
];

const STATUS_BADGE_CLASSES: Record<SignatureRequestStatus, string> = {
  Completed: 'bg-green-100 text-green-700 border-green-200',
  Pending: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  InProgress: 'bg-blue-100 text-blue-700 border-blue-200',
  Rejected: 'bg-red-100 text-red-700 border-red-200',
  Expired: 'bg-gray-100 text-gray-700 border-gray-200',
};

const STATUS_TEXT: Record<SignatureRequestStatus, string> = {
  Completed: 'Completed',
  Pending: 'Pending',
  InProgress: 'In Progress',
  Rejected: 'Rejected',
  Expired: 'Expired',
};

@Component({
  selector: 'app-dashboard-signed-documents',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-signed-documents.component.html',
  styleUrl: './dashboard-signed-documents.component.css',
})
export class DashboardSignedDocumentsComponent {
  readonly aggregatedDocuments = signal<SignedDocument[]>(MOCK_DOCUMENTS);
  readonly selectedDocument = signal<SignedDocument | null>(null);
  readonly showDetailModal = signal(false);
  readonly downloading = signal(false);
  readonly downloadingDocId = signal<string | null>(null);

  readonly signedDocuments = computed(() => {
    return this.aggregatedDocuments()
      .filter(doc => doc.status === 'Completed')
      .sort((a, b) => {
        const dateA = new Date(a.completedAt || a.lastActivity).getTime();
        const dateB = new Date(b.completedAt || b.lastActivity).getTime();
        return dateB - dateA;
      })
      .slice(0, 10);
  });

  readonly hasDocuments = computed(() => this.signedDocuments().length > 0);

  isDownloadingDoc(docId: string): boolean {
    return this.downloadingDocId() === docId;
  }

  openDetails(document: SignedDocument, event: Event): void {
    event.stopPropagation();
    this.selectedDocument.set(document);
    this.showDetailModal.set(true);
  }

  closeModal(): void {
    this.showDetailModal.set(false);
    setTimeout(() => this.selectedDocument.set(null), 300);
  }

  /**
   * Simulates a document download purely on the client: it builds a small
   * stub text blob (there is no real signed PDF behind this mock) and
   * triggers a real browser download, so the interaction still "works"
   * without any backend involved.
   */
  async downloadDocument(document: SignedDocument, event: Event): Promise<void> {
    event.stopPropagation();

    this.downloading.set(true);
    this.downloadingDocId.set(document.id);

    await new Promise(resolve => setTimeout(resolve, 700));

    const stubContent = `This is a placeholder download for "${document.documentInfo.fileName}".\nGenerated locally - no real file is attached to this demo.`;
    const blob = new Blob([stubContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = document.documentInfo.fileName;
    link.click();
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);

    this.downloading.set(false);
    this.downloadingDocId.set(null);
  }

  getTimeSinceCompleted(document: SignedDocument): string {
    const completedDate = new Date(document.completedAt || document.lastActivity);
    const now = new Date();
    const diffMs = now.getTime() - completedDate.getTime();
    const minutes = Math.floor(diffMs / 60_000);
    const hours = Math.floor(diffMs / 3_600_000);
    const days = Math.floor(diffMs / 86_400_000);

    if (minutes < 60) return minutes <= 1 ? 'Just now' : `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  getSignerInitials(signer: SignerInfo): string {
    if (signer.isCustomer && signer.customerInfo?.firstName) {
      const first = signer.customerInfo.firstName.charAt(0);
      const last = signer.customerInfo.middleName?.charAt(0) || '';
      return (first + last).toUpperCase();
    }

    const nameParts = signer.name.split(' ');
    if (nameParts.length >= 2) {
      return (nameParts[0].charAt(0) + nameParts[1].charAt(0)).toUpperCase();
    }
    return signer.name.substring(0, 2).toUpperCase();
  }

  getSignerAvatarColor(index: number): string {
    return SIGNER_AVATAR_COLORS[index % SIGNER_AVATAR_COLORS.length];
  }

  getFileSize(document: SignedDocument): string {
    return this.formatFileSize(document.documentInfo.sizeBytes);
  }

  private formatFileSize(bytes: number): string {
    if (!bytes) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  getStatusBadgeClass(status: SignatureRequestStatus): string {
    return STATUS_BADGE_CLASSES[status] ?? STATUS_BADGE_CLASSES['Expired'];
  }

  getStatusText(status: SignatureRequestStatus): string {
    return STATUS_TEXT[status] ?? 'Unknown';
  }

  getTotalSigningTime(document: SignedDocument): string {
    if (!document.createdAt || !document.completedAt) return 'N/A';
    const created = new Date(document.createdAt);
    const completed = new Date(document.completedAt);
    const diffMs = completed.getTime() - created.getTime();
    const hours = Math.floor(diffMs / 3_600_000);
    const days = Math.floor(diffMs / 86_400_000);
    if (days > 0) return `${days}d ${hours % 24}h`;
    return `${hours}h`;
  }
}
