import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppNotification } from '../ui/notification-list/notification-list.component';

interface NavigationTarget {
  commands: readonly string[];
  queryParams?: Readonly<Record<string, string>>;
}

@Injectable({ providedIn: 'root' })
export class NotificationRouteResolver {
  private readonly router = inject(Router);

  navigate(notification: AppNotification): Promise<boolean> {
    const target = this.resolve(notification);
    return this.router.navigate([...target.commands], { queryParams: target.queryParams });
  }

  resolve(notification: AppNotification): NavigationTarget {
    const id = notification.resourceId;
    const context = notification.resourceContext;

    switch (notification.resourceType) {
      case 'email_thread':
        return {
          commands: ['/email'],
          queryParams: compact({
            accountId: context['accountId'],
            customerId: context['customerId'],
            threadId: context['threadId'] ?? id,
            messageId: context['messageId'],
          }),
        };
      case 'signature_request':
        return id
          ? { commands: ['/signature/requests', id] }
          : this.detailFallback(notification.id);
      case 'client_request':
        return context['customerId']
          ? {
              commands: ['/clients', context['customerId']],
              queryParams: compact({ tab: 'work', requestId: id }),
            }
          : { commands: ['/task'], queryParams: compact({ requestId: id }) };
      case 'task':
      case 'reminder':
        return { commands: ['/task'], queryParams: compact({ taskId: context['taskId'] ?? id }) };
      case 'meeting':
      case 'recording':
        return {
          commands: ['/meetings'],
          queryParams: compact({ meetingId: context['meetingId'] ?? id, recordingId: context['recordingId'] }),
        };
      case 'appointment':
        return { commands: ['/meetings'], queryParams: compact({ appointmentId: id }) };
      case 'billing':
        return { commands: ['/billing'] };
      case 'invoice':
        return { commands: ['/billing'], queryParams: compact({ invoiceId: id }) };
      case 'conversation':
        return { commands: ['/chat'], queryParams: compact({ conversationId: id }) };
      case 'customer_documents':
        return context['customerId']
          ? {
              commands: ['/clients', context['customerId']],
              queryParams: compact({ tab: 'documents', fileId: context['fileId'] ?? id }),
            }
          : { commands: ['/storage'], queryParams: compact({ fileId: id }) };
      case 'file':
      case 'document':
        return { commands: ['/storage'], queryParams: compact({ fileId: id }) };
      case 'storage_settings':
        // No hay pagina dedicada: el gestor de almacenamiento es /storage.
        return { commands: ['/storage'] };
      case 'mailbox_settings':
        // mail-page no abre un panel de settings via queryParams; aterrizar en /email,
        // seleccionar la cuenta por `accountId` ya es util (reading pane de esa cuenta).
        return { commands: ['/email'], queryParams: compact({ accountId: id }) };
      case 'security_settings':
        // profile-page no honra ?section=security; aterrizar en /profile y el usuario
        // elige la pestaña (anadir ancla/section en una fase posterior si hace falta).
        return { commands: ['/profile'] };
      case 'import_job':
        return { commands: ['/clients/import'], queryParams: compact({ jobId: id }) };
      case 'support_ticket':
        return { commands: ['/support'], queryParams: compact({ ticketId: id }) };
      case 'seats':
        return { commands: ['/company/users'] };
      default:
        return this.detailFallback(notification.id);
    }
  }

  private detailFallback(notificationId: string): NavigationTarget {
    return { commands: ['/notifications'], queryParams: { notificationId } };
  }
}

function compact(values: Readonly<Record<string, string | null | undefined>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => !!entry[1]),
  );
}
