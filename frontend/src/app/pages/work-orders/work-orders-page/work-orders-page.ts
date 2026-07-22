import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, NgZone, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../auth/auth.service';
import { CreateWorkOrderRequest, TimelineComponent } from '../timeline/timeline';
import { BuildablePart, WorkCenterDocument, WorkOrderDocument, WorkOrderErrorBody } from '../../../models/work-orders.models';
import { WorkOrdersService } from '../../../services/work-orders.service';
import { WorkOrderPanel, WorkOrderPanelSubmitEvent } from '../panel/work-order-panel/work-order-panel';
import { buildWorkOrdersCsvContent, buildWorkOrdersExportFileName } from './work-orders-export';
import { buildTimelineRange, Timescale } from './timeline-range';

@Component({
  selector: 'app-work-orders-page',
  imports: [CommonModule, FormsModule, NgSelectModule, TimelineComponent, WorkOrderPanel],
  templateUrl: './work-orders-page.html',
  styleUrl: './work-orders-page.scss',
  standalone: true
})
export class WorkOrdersPage implements OnInit {
  protected readonly timescales: Timescale[] = ['Day', 'Week', 'Month'];
  protected selectedTimescale: Timescale = 'Day';
  protected workCenters: WorkCenterDocument[] = [];
  protected workOrders: WorkOrderDocument[] = [];
  protected buildableParts: BuildablePart[] = [];
  protected timelineHeader: string[] = [];
  protected timelineDates: Date[] = [];
  protected isPanelOpen = false;
  protected isLoading = true;
  protected panelMode: 'create' | 'edit' = 'create';
  protected selectedOrder: WorkOrderDocument | null = null;
  protected pendingCreateStartDate: string | null = null;
  protected pendingCreateWorkCenterId: string | null = null;
  protected loadError: string | null = null;
  protected panelSaveError: string | null = null;
  @ViewChild(TimelineComponent) private timeline?: TimelineComponent;

  protected get canScrollToToday(): boolean {
    return this.timeline?.hasCurrentPeriod ?? false;
  }

  protected get currentUser() {
    return this.authService.currentUser();
  }

  protected get canManageWorkOrders(): boolean {
    return this.authService.canManageWorkOrders();
  }

  constructor(
    private readonly workOrdersService: WorkOrdersService,
    private readonly authService: AuthService,
    private readonly ngZone: NgZone,
    private readonly cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadPageData();
  }

  protected onTimescaleChange(value: Timescale | null): void {
    if (!value) {
      return;
    }
    this.selectedTimescale = value;
    this.buildTimeline(value);
  }

  protected onTodayClick(): void {
    this.timeline?.scrollToToday();
  }

  protected onExportCsv(): void {
    if (!this.workOrders.length) {
      return;
    }

    const csvContent = buildWorkOrdersCsvContent(this.workCenters, this.workOrders);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildWorkOrdersExportFileName(new Date());
    link.click();
    URL.revokeObjectURL(url);
  }

  protected onEditWorkOrder(order: WorkOrderDocument): void {
    this.ngZone.run(() => {
      this.selectedOrder = order;
      this.panelMode = 'edit';
      this.panelSaveError = null;
      this.isPanelOpen = true;
      this.cdr.detectChanges();
    });
  }

  protected async onDeleteWorkOrder(order: WorkOrderDocument): Promise<void> {
    if (!this.canManageWorkOrders) {
      return;
    }

    try {
      await firstValueFrom(this.workOrdersService.deleteWorkOrder(order.docId));
      this.workOrders = this.workOrders.filter((item) => item.docId !== order.docId);
      if (this.selectedOrder?.docId === order.docId) {
        this.onClosePanel();
      }
      this.buildTimeline(this.selectedTimescale);
      this.loadError = null;
    } catch (error) {
      this.loadError = this.buildSaveErrorMessage(error, 'Unable to delete the work order. Check that the API is running.');
    }
  }

  protected onCreateWorkOrder(request: CreateWorkOrderRequest): void {
    if (!this.canManageWorkOrders) {
      return;
    }

    this.ngZone.run(() => {
      this.panelMode = 'create';
      this.selectedOrder = null;
      this.pendingCreateStartDate = request.startDate;
      this.pendingCreateWorkCenterId = request.workCenterId;
      this.panelSaveError = null;
      this.isPanelOpen = true;
      this.cdr.detectChanges();
    });
  }

  protected onClosePanel(): void {
    this.isPanelOpen = false;
    this.selectedOrder = null;
    this.pendingCreateStartDate = null;
    this.pendingCreateWorkCenterId = null;
    this.panelSaveError = null;
  }

  protected async onSaveOrder(event: WorkOrderPanelSubmitEvent): Promise<void> {
    if (!this.canManageWorkOrders) {
      this.panelSaveError = 'Your role does not allow editing work orders.';
      return;
    }

    const targetWorkCenterId = event.value.workCenterId;
    const excludeOrderId = event.mode === 'edit' ? event.orderId : null;
    const nextStart = this.toUtcMillis(event.value.startDate);
    const nextEnd = this.toUtcMillis(event.value.endDate);

    // Keep a second guard here even though the panel validates dates, so invalid
    // values cannot be persisted through any future UI or programmatic path.
    if (Number.isNaN(nextStart) || Number.isNaN(nextEnd) || nextStart > nextEnd) {
      this.panelSaveError = 'End date must be on or after start date.';
      return;
    }

    if (this.hasOverlap(targetWorkCenterId, event.value.startDate, event.value.endDate, excludeOrderId)) {
      this.panelSaveError = 'Dates overlap an existing work order on this work center.';
      return;
    }
    this.panelSaveError = null;

    if (event.mode === 'edit' && event.orderId) {
      const existingOrder = this.workOrders.find((order) => order.docId === event.orderId);
      if (!existingOrder) {
        this.panelSaveError = 'The selected work order no longer exists.';
        return;
      }

      try {
        const updatedOrder = await firstValueFrom(this.workOrdersService.updateWorkOrder({
          ...existingOrder,
          data: {
            ...existingOrder.data,
            name: event.value.name,
            workCenterId: targetWorkCenterId,
            partId: event.value.partId,
            quantity: event.value.quantity,
            status: event.value.status,
            startDate: event.value.startDate,
            endDate: event.value.endDate
          }
        }));
        this.workOrders = this.workOrders.map((order) =>
          order.docId === event.orderId ? updatedOrder : order
        );
        this.buildTimeline(this.selectedTimescale);
        this.onClosePanel();
      } catch (error) {
        this.panelSaveError = this.buildSaveErrorMessage(error, 'Unable to save the work order. Check that the API is running.');
      }
      return;
    }

    try {
      const createdOrder = await firstValueFrom(this.workOrdersService.createWorkOrder({
        data: {
          name: event.value.name,
          workCenterId: targetWorkCenterId,
          partId: event.value.partId,
          quantity: event.value.quantity,
          status: event.value.status,
          startDate: event.value.startDate,
          endDate: event.value.endDate
        }
      }));
      this.workOrders = [...this.workOrders, createdOrder];
      this.buildTimeline(this.selectedTimescale);
      this.onClosePanel();
    } catch (error) {
      this.panelSaveError = this.buildSaveErrorMessage(error, 'Unable to create the work order. Check that the API is running.');
    }
  }

  protected onLogout(): void {
    this.authService.logout();
  }

  private async loadPageData(): Promise<void> {
    this.isLoading = true;
    this.loadError = null;

    try {
      const [workCenters, workOrders, buildableParts] = await Promise.all([
        firstValueFrom(this.workOrdersService.getWorkCenters()),
        firstValueFrom(this.workOrdersService.getWorkOrders()),
        firstValueFrom(this.workOrdersService.getBuildableParts())
      ]);
      this.workCenters = workCenters;
      this.workOrders = workOrders;
      this.buildableParts = buildableParts;
      this.buildTimeline(this.selectedTimescale);
    } catch {
      this.loadError = 'Unable to load work orders. Start the API and verify the database connection.';
    } finally {
      this.isLoading = false;
    }
  }

  private hasOverlap(
    workCenterId: string,
    startDate: string,
    endDate: string,
    excludeOrderId: string | null
  ): boolean {
    const nextStart = this.toUtcMillis(startDate);
    const nextEnd = this.toUtcMillis(endDate);
    if (Number.isNaN(nextStart) || Number.isNaN(nextEnd)) {
      return false;
    }

    return this.workOrders.some((order) => {
      if (order.data.workCenterId !== workCenterId) {
        return false;
      }
      if (excludeOrderId && order.docId === excludeOrderId) {
        return false;
      }
      const existingStart = this.toUtcMillis(order.data.startDate);
      const existingEnd = this.toUtcMillis(order.data.endDate);
      // Inclusive comparison prevents back-dated collisions inside the same work center.
      return nextStart <= existingEnd && nextEnd >= existingStart;
    });
  }

  private toUtcMillis(dateString: string): number {
    return new Date(`${dateString}T00:00:00Z`).getTime();
  }

  private buildTimeline(scale: Timescale): void {
    const range = buildTimelineRange(scale, this.workOrders);
    this.timelineDates = range.dates;
    this.timelineHeader = range.header;
  }

  private buildSaveErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as WorkOrderErrorBody | null;
      if (body?.shortages?.length) {
        const details = body.shortages
          .map((shortage) => `${shortage.partName}: need ${shortage.requiredQty}, on hand ${shortage.onHand} (short ${shortage.shortBy})`)
          .join('; ');
        return `${body.message ?? 'Cannot complete: insufficient component inventory.'} ${details}`;
      }
      if (body?.message) {
        return body.message;
      }
    }
    return fallback;
  }

}
