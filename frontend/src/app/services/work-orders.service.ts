import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { WorkCenterDocument, WorkOrderDocument } from '../models/work-orders.models';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WorkOrdersService {
  private readonly http = inject(HttpClient);
  // Frontend calls are centralized here so the page component does not hardcode endpoint URLs.
  private readonly apiBaseUrl = environment.apiBaseUrl;

  getWorkCenters(): Observable<WorkCenterDocument[]> {
    return this.http.get<WorkCenterDocument[]>(`${this.apiBaseUrl}/work-centers`);
  }

  getWorkOrders(): Observable<WorkOrderDocument[]> {
    return this.http.get<WorkOrderDocument[]>(`${this.apiBaseUrl}/work-orders`);
  }

  createWorkOrder(workOrder: Omit<WorkOrderDocument, 'docId' | 'docType'> & { docId?: string; docType?: string }): Observable<WorkOrderDocument> {
    // The API generates the new `docId`, so the frontend only sends the editable fields.
    return this.http.post<WorkOrderDocument>(`${this.apiBaseUrl}/work-orders`, {
      name: workOrder.data.name,
      workCenterId: workOrder.data.workCenterId,
      status: workOrder.data.status,
      startDate: workOrder.data.startDate,
      endDate: workOrder.data.endDate
    });
  }

  updateWorkOrder(workOrder: WorkOrderDocument): Observable<WorkOrderDocument> {
    // `workOrder.docId` becomes the `{id}` segment in the API route: `/api/work-orders/{id}`.
    return this.http.put<WorkOrderDocument>(`${this.apiBaseUrl}/work-orders/${workOrder.docId}`, {
      name: workOrder.data.name,
      workCenterId: workOrder.data.workCenterId,
      status: workOrder.data.status,
      startDate: workOrder.data.startDate,
      endDate: workOrder.data.endDate
    });
  }

  deleteWorkOrder(workOrderId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiBaseUrl}/work-orders/${workOrderId}`);
  }
}
