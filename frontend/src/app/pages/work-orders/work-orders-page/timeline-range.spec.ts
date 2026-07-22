import { WorkOrderDocument } from '../../../models/work-orders.models';
import { buildTimelineRange } from './timeline-range';

describe('timeline-range', () => {
  function order(startDate: string, endDate: string): WorkOrderDocument {
    return {
      docId: 'wo-1',
      docType: 'workOrder',
      data: {
        name: 'Order',
        workCenterId: 'wc-005',
        status: 'open',
        startDate,
        endDate,
        partId: 'part-wheel-assembly',
        quantity: 1
      }
    };
  }

  it('should pad the day range by 14 days on each side of the order bounds', () => {
    const range = buildTimelineRange('Day', [order('2026-03-10', '2026-03-12')]);

    expect(range.dates[0]).toEqual(new Date(2026, 1, 24));
    expect(range.dates[range.dates.length - 1]).toEqual(new Date(2026, 2, 26));
    expect(range.header[0]).toBe('Feb 24');
    expect(range.dates.length).toBe(range.header.length);
  });

  it('should start week buckets on Mondays with week-number headers', () => {
    const range = buildTimelineRange('Week', [order('2026-03-10', '2026-03-12')]);

    for (const date of range.dates) {
      expect(date.getDay()).toBe(1);
    }
    expect(range.header[0]).toMatch(/^Wk \d+$/);
  });

  it('should produce first-of-month buckets spanning the orders with 2 months padding', () => {
    const range = buildTimelineRange('Month', [order('2026-03-10', '2026-04-12')]);

    expect(range.dates[0]).toEqual(new Date(2026, 0, 1));
    expect(range.dates[range.dates.length - 1]).toEqual(new Date(2026, 5, 1));
    expect(range.header).toContain('Mar 2026');
  });

  it('should fall back to today when there are no orders', () => {
    const range = buildTimelineRange('Day', []);

    expect(range.dates.length).toBe(29);
  });
});
