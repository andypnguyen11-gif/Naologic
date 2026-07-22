import { WorkCenterDocument, WorkOrderDocument } from '../../../models/work-orders.models';

// Pure CSV assembly for the work-orders export, kept out of the page component
// so it can be unit-tested without a TestBed.

export function buildWorkOrdersCsvContent(
  workCenters: WorkCenterDocument[],
  workOrders: WorkOrderDocument[]
): string {
  const csvRows = [
    ['Work Center', 'Work Order', 'Part', 'Quantity', 'Status', 'Start Date', 'End Date'],
    ...buildExportRows(workCenters, workOrders)
  ];

  return csvRows
    .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
    .join('\r\n');
}

export function buildWorkOrdersExportFileName(today: Date): string {
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');
  return `naologic-work-orders-${year}-${month}-${day}.csv`;
}

function buildExportRows(
  workCenters: WorkCenterDocument[],
  workOrders: WorkOrderDocument[]
): string[][] {
  const workCenterNameById = new Map(
    workCenters.map((workCenter) => [workCenter.docId, workCenter.data.name])
  );

  return [...workOrders]
    .sort((left, right) => {
      const centerCompare = (workCenterNameById.get(left.data.workCenterId) ?? '').localeCompare(
        workCenterNameById.get(right.data.workCenterId) ?? ''
      );
      if (centerCompare !== 0) {
        return centerCompare;
      }

      const startCompare = toUtcMillis(left.data.startDate) - toUtcMillis(right.data.startDate);
      if (startCompare !== 0) {
        return startCompare;
      }

      return left.data.name.localeCompare(right.data.name);
    })
    .map((order) => [
      workCenterNameById.get(order.data.workCenterId) ?? 'Unknown Work Center',
      order.data.name,
      order.data.partName ?? order.data.partId,
      `${order.data.quantity}`,
      formatStatusForExport(order.data.status),
      order.data.startDate,
      order.data.endDate
    ]);
}

function formatStatusForExport(status: WorkOrderDocument['data']['status']): string {
  if (status === 'in-progress') {
    return 'In Progress';
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function escapeCsvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toUtcMillis(dateString: string): number {
  return new Date(`${dateString}T00:00:00Z`).getTime();
}
