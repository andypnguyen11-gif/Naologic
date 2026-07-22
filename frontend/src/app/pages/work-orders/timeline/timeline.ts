import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { WorkCenterDocument, WorkOrderDocument } from '../../../models/work-orders.models';

export interface CreateWorkOrderRequest {
  workCenterId: string;
  startDate: string;
}

@Component({
  selector: 'app-timeline',
  standalone: true,
  imports: [CommonModule, FormsModule, NgSelectModule],
  templateUrl: './timeline.html',
  styleUrl: './timeline.scss'
})
export class TimelineComponent implements OnChanges, AfterViewInit {
  @Input({ required: true }) timescaleLabel: Timescale = 'Month';
  @Input({ required: true }) workCenters: WorkCenterDocument[] = [];
  @Input({ required: true }) timelineHeader: string[] = [];
  @Input({ required: true }) timelineDates: Date[] = [];
  @Input({ required: true }) workOrders: WorkOrderDocument[] = [];
  @Input() allowEditing = true;
  @Output() editWorkOrder = new EventEmitter<WorkOrderDocument>();
  @Output() deleteWorkOrder = new EventEmitter<WorkOrderDocument>();
  @Output() createWorkOrder = new EventEmitter<CreateWorkOrderRequest>();
  @ViewChild('timelineViewport') private timelineViewport?: ElementRef<HTMLDivElement>;
  @ViewChild('timelineScroller') private timelineScroller?: ElementRef<HTMLDivElement>;
  @ViewChild('timescaleGrid') private timescaleGrid?: ElementRef<HTMLDivElement>;

  private indexMap = new Map<string, number>();
  protected readonly actionOptions: ActionOption[] = [
    { label: 'Edit', value: 'edit' },
    { label: 'Delete', value: 'delete' }
  ];
  private selectedActionByOrderId: Record<string, ActionValue | null> = {};
  protected openedActionOrderId: string | null = null;
  protected openedActionWorkCenterId: string | null = null;
  protected hoveredWorkCenterId: string | null = null;
  protected hoveredTimelineCellWorkCenterId: string | null = null;
  protected hoveredTimelineCellGridColumn: string | null = null;
  protected hoveredTooltipOrder: WorkOrderDocument | null = null;
  protected hoveredBarTooltipLeftPx = 0;
  protected hoveredBarTooltipTopPx = 0;

  ngAfterViewInit(): void {
    this.scheduleScrollToCurrentPeriod();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['timelineDates'] || changes['timescaleLabel']) {
      this.rebuildIndexMap();
      this.scheduleScrollToCurrentPeriod();
    }
  }

  get gridTemplateColumns(): string {
    return `repeat(${this.timelineHeader.length}, minmax(120px, 1fr))`;
  }

  get hasCurrentPeriod(): boolean {
    return this.currentPeriodIndex !== null;
  }

  get currentPeriodIndex(): number | null {
    return this.getIndexForDate(new Date());
  }

  get currentPeriodGridColumn(): string | null {
    return this.currentPeriodIndex !== null ? `${this.currentPeriodIndex + 1}` : null;
  }

  getWorkOrdersForCenter(centerId: string): WorkOrderDocument[] {
    return this.workOrders.filter((order) => {
      if (order.data.workCenterId !== centerId) {
        return false;
      }
      return this.getVisibleRangeForOrder(order) !== null;
    });
  }

  getGridColumn(order: WorkOrderDocument): string | null {
    const visibleRange = this.getVisibleRangeForOrder(order);
    if (!visibleRange) {
      return null;
    }
    // CSS grid end lines are exclusive, so add one more column to cover the
    // last visible unit occupied by the work order.
    const safeEnd = Math.max(visibleRange.start, visibleRange.end);
    return `${visibleRange.start + 1} / ${safeEnd + 2}`;
  }

  getBarStartInsetPercent(order: WorkOrderDocument): number {
    const visibleRange = this.getVisibleRangeForOrder(order);
    if (!visibleRange) {
      return 0;
    }
    // Convert the fractional start position inside the first visible unit into
    // a percentage so the bar can start partway through a week/month column.
    const span = Math.max(1, visibleRange.end - visibleRange.start + 1);
    return (visibleRange.startOffset / span) * 100;
  }

  getBarEndInsetPercent(order: WorkOrderDocument): number {
    const visibleRange = this.getVisibleRangeForOrder(order);
    if (!visibleRange) {
      return 0;
    }
    // The right inset uses the unused portion of the last visible unit so the
    // bar can end partway through the final week/month column.
    const span = Math.max(1, visibleRange.end - visibleRange.start + 1);
    return ((1 - visibleRange.endOffset) / span) * 100;
  }

  getWorkOrderTooltipStatus(order: WorkOrderDocument): string {
    return this.formatStatus(order.data.status);
  }

  getWorkOrderTooltipPart(order: WorkOrderDocument): string {
    const label = order.data.partName ?? order.data.partId;
    return `${label} × ${order.data.quantity}`;
  }

  getWorkOrderTooltipDateRange(order: WorkOrderDocument): string {
    const start = this.parseStoredDate(order.data.startDate);
    const end = this.parseStoredDate(order.data.endDate);
    return `${this.formatTooltipDate(start)} - ${this.formatTooltipDate(end)}`;
  }

  onBarHover(orderId: string, event: MouseEvent): void {
    const bar = event.currentTarget as HTMLElement | null;
    const viewport = this.timelineViewport?.nativeElement;
    if (!bar || !viewport) {
      return;
    }

    const order = this.workOrders.find((candidate) => candidate.docId === orderId) ?? null;
    if (!order) {
      return;
    }

    const rect = bar.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const minAnchor = 24;
    const maxAnchor = Math.max(rect.width - 24, minAnchor);
    const nextAnchor = Math.min(Math.max(event.clientX - rect.left, minAnchor), maxAnchor);

    // Position the tooltip in the outer viewport layer so it can render above
    // the timeline grid even when the hovered bar sits on the first row.
    this.hoveredTooltipOrder = order;
    this.hoveredBarTooltipLeftPx = rect.left - viewportRect.left + nextAnchor;
    this.hoveredBarTooltipTopPx = rect.top - viewportRect.top - 10;
  }

  onBarLeave(orderId: string): void {
    if (this.hoveredTooltipOrder?.docId === orderId) {
      this.hoveredTooltipOrder = null;
    }
  }

  onEditClick(order: WorkOrderDocument): void {
    this.editWorkOrder.emit(order);
  }

  onDeleteClick(order: WorkOrderDocument): void {
    this.deleteWorkOrder.emit(order);
  }

  onActionChange(order: WorkOrderDocument, selection: ActionSelection | null): void {
    if (!this.allowEditing) {
      return;
    }

    const action = this.resolveAction(selection);
    if (!action) {
      return;
    }
    this.selectedActionByOrderId[order.docId] = action;

    if (action === 'edit') {
      this.onEditClick(order);
    } else {
      this.onDeleteClick(order);
    }

    setTimeout(() => {
      this.selectedActionByOrderId[order.docId] = null;
    }, 0);
    this.openedActionOrderId = null;
    this.openedActionWorkCenterId = null;
  }

  onTimelineCellClick(workCenterId: string, date: Date, event: MouseEvent): void {
    event.stopPropagation();
    if (!this.allowEditing) {
      return;
    }

    this.createWorkOrder.emit({
      workCenterId,
      startDate: this.formatDate(date)
    });
  }

  onTimelineCellHover(workCenterId: string, date: Date | null): void {
    if (!date) {
      this.hoveredTimelineCellWorkCenterId = null;
      this.hoveredTimelineCellGridColumn = null;
      return;
    }

    const index = this.getIndexForDate(date);
    this.hoveredTimelineCellWorkCenterId = workCenterId;
    this.hoveredTimelineCellGridColumn = index !== null ? `${index + 1}` : null;
  }

  getSelectedAction(orderId: string): ActionValue | null {
    return this.selectedActionByOrderId[orderId] ?? null;
  }

  onActionOpen(orderId: string, workCenterId: string): void {
    this.selectedActionByOrderId[orderId] = null;
    this.openedActionOrderId = orderId;
    this.openedActionWorkCenterId = workCenterId;
  }

  onActionClose(orderId: string, workCenterId: string): void {
    this.selectedActionByOrderId[orderId] = null;
    if (this.openedActionOrderId === orderId) {
      this.openedActionOrderId = null;
    }
    if (this.openedActionWorkCenterId === workCenterId) {
      this.openedActionWorkCenterId = null;
    }
  }

  isActionRowOpen(workCenterId: string): boolean {
    return this.openedActionWorkCenterId === workCenterId;
  }

  onRowHover(workCenterId: string | null): void {
    this.hoveredWorkCenterId = workCenterId;
  }

  isRowHovered(workCenterId: string): boolean {
    return this.hoveredWorkCenterId === workCenterId;
  }

  private rebuildIndexMap(): void {
    // Normalize the rendered timeline units once so bar placement can do fast
    // lookups instead of rescanning the header for every work order.
    this.indexMap = new Map(
      this.timelineDates.map((date, index) => [this.unitKey(date), index])
    );
  }

  private getIndexForDate(date: Date): number | null {
    const key = this.unitKey(date);
    return this.indexMap.has(key) ? this.indexMap.get(key)! : null;
  }

  private getVisibleRangeForOrder(order: WorkOrderDocument): VisibleRange | null {
    if (!this.timelineDates.length) {
      return null;
    }

    const firstVisible = this.timelineDates[0];
    const lastVisible = this.timelineDates[this.timelineDates.length - 1];
    const orderStart = this.parseStoredDate(order.data.startDate);
    const orderEnd = this.parseStoredDate(order.data.endDate);

    const normalizedVisibleStart = this.normalizeForTimescale(firstVisible);
    const normalizedVisibleEnd = this.normalizeForTimescale(lastVisible);
    const normalizedOrderStart = this.normalizeForTimescale(orderStart);
    const normalizedOrderEnd = this.normalizeForTimescale(orderEnd);

    if (normalizedOrderEnd < normalizedVisibleStart || normalizedOrderStart > normalizedVisibleEnd) {
      return null;
    }

    // Bars can start before or end after the rendered window, so clip them first
    // and then use offsets to preserve the partial position inside the edge cell.
    const clippedStart = normalizedOrderStart < normalizedVisibleStart
      ? normalizedVisibleStart
      : normalizedOrderStart;
    const clippedEnd = normalizedOrderEnd > normalizedVisibleEnd
      ? normalizedVisibleEnd
      : normalizedOrderEnd;

    const start = this.getIndexForDate(clippedStart);
    const end = this.getIndexForDate(clippedEnd);
    if (start === null || end === null) {
      return null;
    }

    return {
      start,
      end,
      startOffset: normalizedOrderStart < normalizedVisibleStart
        ? 0
        : this.getPositionWithinUnit(orderStart),
      endOffset: normalizedOrderEnd > normalizedVisibleEnd
        ? 1
        : this.getPositionWithinUnit(orderEnd)
    };
  }

  private unitKey(date: Date): string {
    // Every lookup key is normalized to the active timescale so the same date
    // maps correctly in Day, Week, and Month views.
    const d = this.normalizeForTimescale(date);
    return d.toISOString();
  }

  private normalizeForTimescale(date: Date): Date {
    const d = new Date(date);
    if (this.timescaleLabel === 'Day') {
      d.setHours(0, 0, 0, 0);
      return d;
    }
    if (this.timescaleLabel === 'Week') {
      const day = d.getDay();
      const diff = (day + 6) % 7;
      d.setDate(d.getDate() - diff);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private getPositionWithinUnit(date: Date): number {
    if (this.timescaleLabel === 'Day') {
      return 0;
    }

    if (this.timescaleLabel === 'Week') {
      // Convert Sunday-based JS dates to a Monday-based fraction for the week column.
      const day = (date.getDay() + 6) % 7;
      return day / 6;
    }

    // Month view uses a fractional position so bars can begin/end inside the month cell
    // instead of snapping to the full column width.
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    if (daysInMonth <= 1) {
      return 0;
    }
    return (date.getDate() - 1) / (daysInMonth - 1);
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatStatus(status: WorkOrderDocument['data']['status']): string {
    if (status === 'in-progress') {
      return 'In Progress';
    }
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  private formatTooltipDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  private parseStoredDate(dateString: string): Date {
    // Parse as a calendar date in local time to avoid UTC parsing shifting the
    // work order into the previous day or month for some time zones.
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
  }

  private resolveAction(selection: ActionSelection | null): ActionValue | null {
    if (!selection) {
      return null;
    }
    if (typeof selection === 'string') {
      return selection;
    }
    return selection.value;
  }

  private scheduleScrollToCurrentPeriod(): void {
    // Wait for Angular to render the updated grid before measuring marker and
    // scroller positions for the initial/current-period centering.
    queueMicrotask(() => {
      requestAnimationFrame(() => this.scrollToCurrentPeriod());
    });
  }

  private scrollToCurrentPeriod(): void {
    this.scrollToToday();
  }

  scrollToToday(): void {
    this.scrollToDate(new Date());
  }

  private scrollToDate(date: Date): void {
    const index = this.getIndexForDate(date);
    if (index === null) {
      return;
    }

    const scroller = this.timelineScroller?.nativeElement;
    const grid = this.timescaleGrid?.nativeElement;
    if (!scroller || !grid) {
      return;
    }

    const cell = grid.children.item(index) as HTMLElement | null;
    if (!cell) {
      return;
    }

    const targetLeft = cell.offsetLeft - (scroller.clientWidth / 2) + (cell.offsetWidth / 2);
    const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollLeft = Math.min(Math.max(0, targetLeft), maxScrollLeft);
  }
}

type Timescale = 'Day' | 'Week' | 'Month';
type ActionValue = 'edit' | 'delete';
type ActionSelection = ActionValue | ActionOption;

interface ActionOption {
  label: string;
  value: ActionValue;
}

interface VisibleRange {
  start: number;
  end: number;
  startOffset: number;
  endOffset: number;
}
