import { WorkCenterDocument, WorkOrderDocument } from '../../../models/work-orders.models';
import { buildWorkOrdersCsvContent, buildWorkOrdersExportFileName } from './work-orders-export';

describe('work-orders-export', () => {
  const workCenters: WorkCenterDocument[] = [
    { docId: 'wc-003', docType: 'workCenter', data: { name: 'Final Assembly' } },
    { docId: 'wc-005', docType: 'workCenter', data: { name: 'Wheel Build Line' } }
  ];

  function order(
    docId: string,
    name: string,
    workCenterId: string,
    startDate: string,
    partName?: string
  ): WorkOrderDocument {
    const data: WorkOrderDocument['data'] = {
      name,
      workCenterId,
      status: 'in-progress',
      startDate,
      endDate: '2026-04-01',
      partId: 'part-wheel-assembly',
      quantity: 8,
      partNumber: 'ASM-310'
    };
    if (partName !== undefined) {
      data.partName = partName;
    }
    return { docId, docType: 'workOrder', data };
  }

  it('should render header, part, quantity, and formatted status', () => {
    const csv = buildWorkOrdersCsvContent(workCenters, [
      order('wo-1', 'Batch 1', 'wc-005', '2026-03-01', 'Wheel Assembly')
    ]);
    const rows = csv.split('\r\n');

    expect(rows[0]).toBe('"Work Center","Work Order","Part","Quantity","Status","Start Date","End Date"');
    expect(rows[1]).toBe('"Wheel Build Line","Batch 1","Wheel Assembly","8","In Progress","2026-03-01","2026-04-01"');
  });

  it('should sort by work center name, then start date', () => {
    const csv = buildWorkOrdersCsvContent(workCenters, [
      order('wo-1', 'Wheel Later', 'wc-005', '2026-03-10'),
      order('wo-2', 'Assembly Order', 'wc-003', '2026-03-05'),
      order('wo-3', 'Wheel Earlier', 'wc-005', '2026-03-01')
    ]);
    const names = csv.split('\r\n').slice(1).map((row) => row.split('","')[1]);

    expect(names).toEqual(['Assembly Order', 'Wheel Earlier', 'Wheel Later']);
  });

  it('should fall back to the part id when the part name is missing and escape quotes', () => {
    const csv = buildWorkOrdersCsvContent(workCenters, [
      order('wo-1', 'Say "hi"', 'wc-005', '2026-03-01')
    ]);

    expect(csv).toContain('"Say ""hi"""');
    expect(csv).toContain('"part-wheel-assembly"');
  });

  it('should build a dated file name', () => {
    expect(buildWorkOrdersExportFileName(new Date(2026, 6, 22)))
      .toBe('naologic-work-orders-2026-07-22.csv');
  });
});
