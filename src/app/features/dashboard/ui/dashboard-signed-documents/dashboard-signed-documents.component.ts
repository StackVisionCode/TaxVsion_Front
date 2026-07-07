import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

type DocumentStatus = 'Signed' | 'Pending';

interface SignerAvatar {
  initials: string;
  bg: string;
}

interface SignedDocumentRow {
  fileName: string;
  /** Pastel background for the file-icon circle (rotates through the Aether pastels). */
  iconBg: string;
  signers: SignerAvatar[];
  date: string;
  status: DocumentStatus;
}

/**
 * "Signed Documents" widget (Aether reference): list of recent e-signature
 * files with a pastel file icon, an overlapping mini avatar stack for the
 * signers and an outline status chip. Static data, no backend.
 */
@Component({
  selector: 'app-dashboard-signed-documents',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-signed-documents.component.html',
})
export class DashboardSignedDocumentsComponent {
  readonly documents: SignedDocumentRow[] = [
    {
      fileName: 'W9_Form-Maria-Gonzalez.pdf',
      iconBg: 'bg-[#F2E3C9]',
      signers: [
        { initials: 'MG', bg: 'bg-gray-900' },
        { initials: 'CI', bg: 'bg-indigo-600' },
        { initials: 'SL', bg: 'bg-gray-900' },
      ],
      date: 'Jun 30, 2026',
      status: 'Signed',
    },
    {
      fileName: '2025_Tax_Return-John-Smith.pdf',
      iconBg: 'bg-[#CBD9F2]',
      signers: [
        { initials: 'JS', bg: 'bg-indigo-600' },
        { initials: 'AR', bg: 'bg-gray-900' },
      ],
      date: 'Jun 27, 2026',
      status: 'Signed',
    },
    {
      fileName: '1099_Authorization-Robert-Lee.pdf',
      iconBg: 'bg-[#DCDCDC]',
      signers: [
        { initials: 'RL', bg: 'bg-gray-900' },
        { initials: 'AR', bg: 'bg-indigo-600' },
      ],
      date: 'Jun 29, 2026',
      status: 'Pending',
    },
    {
      fileName: 'Extension_Request_4868-David-Chen.pdf',
      iconBg: 'bg-[#F2E3C9]',
      signers: [
        { initials: 'DC', bg: 'bg-indigo-600' },
        { initials: 'AR', bg: 'bg-gray-900' },
      ],
      date: 'Jun 20, 2026',
      status: 'Signed',
    },
    {
      fileName: 'Engagement_Letter_2026-Linda-Park.pdf',
      iconBg: 'bg-[#CBD9F2]',
      signers: [{ initials: 'LP', bg: 'bg-gray-900' }],
      date: 'Jun 13, 2026',
      status: 'Signed',
    },
  ];

  statusChipClass(status: DocumentStatus): string {
    return status === 'Signed'
      ? 'border-emerald-200 text-emerald-600'
      : 'border-orange-200 text-orange-500';
  }
}
