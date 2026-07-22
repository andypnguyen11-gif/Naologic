import { WorkOrderDocument } from '../../../models/work-orders.models';

export type Timescale = 'Day' | 'Week' | 'Month';

export interface TimelineRange {
  dates: Date[];
  header: string[];
}

// Pure timeline-axis math for the work-orders page: derives the rendered date
// range (with padding) and its header labels from the orders and the timescale.

export function buildTimelineRange(scale: Timescale, workOrders: WorkOrderDocument[]): TimelineRange {
  const { start, end } = getWorkOrderDateBounds(workOrders);

  if (scale === 'Day') {
    const dates = buildDayRange(start, end, 14);
    return {
      dates,
      header: dates.map((date) =>
        date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      )
    };
  }

  if (scale === 'Week') {
    const dates = buildWeekRange(start, end, 2);
    return {
      dates,
      header: dates.map((date) => `Wk ${getWeekNumber(date)}`)
    };
  }

  const dates = buildMonthRange(start, end, 2);
  return {
    dates,
    header: dates.map((date) =>
      date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    )
  };
}

function getWorkOrderDateBounds(workOrders: WorkOrderDocument[]): { start: Date; end: Date } {
  if (!workOrders.length) {
    const today = new Date();
    return { start: today, end: today };
  }

  // Build the rendered range from the actual work-order bounds so users can
  // scroll to the earliest and latest scheduled items in the sample data.
  let earliest = parseStoredDate(workOrders[0].data.startDate);
  let latest = parseStoredDate(workOrders[0].data.endDate);

  for (const order of workOrders) {
    const orderStart = parseStoredDate(order.data.startDate);
    const orderEnd = parseStoredDate(order.data.endDate);
    if (orderStart < earliest) {
      earliest = orderStart;
    }
    if (orderEnd > latest) {
      latest = orderEnd;
    }
  }

  return { start: earliest, end: latest };
}

function buildDayRange(start: Date, end: Date, paddingDays: number): Date[] {
  const dates: Date[] = [];
  const first = new Date(start);
  first.setDate(first.getDate() - paddingDays);
  first.setHours(0, 0, 0, 0);

  const last = new Date(end);
  last.setDate(last.getDate() + paddingDays);
  last.setHours(0, 0, 0, 0);

  for (const d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d));
  }
  return dates;
}

function buildWeekRange(start: Date, end: Date, paddingWeeks: number): Date[] {
  const dates: Date[] = [];
  const first = startOfWeek(start);
  first.setDate(first.getDate() - (paddingWeeks * 7));

  const last = startOfWeek(end);
  last.setDate(last.getDate() + (paddingWeeks * 7));

  for (const d = new Date(first); d <= last; d.setDate(d.getDate() + 7)) {
    dates.push(new Date(d));
  }
  return dates;
}

function buildMonthRange(start: Date, end: Date, paddingMonths: number): Date[] {
  const dates: Date[] = [];
  const first = new Date(start.getFullYear(), start.getMonth() - paddingMonths, 1);
  const last = new Date(end.getFullYear(), end.getMonth() + paddingMonths, 1);

  for (
    const d = new Date(first.getFullYear(), first.getMonth(), 1);
    d <= last;
    d.setMonth(d.getMonth() + 1)
  ) {
    dates.push(new Date(d));
  }
  return dates;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function parseStoredDate(dateString: string): Date {
  // Use local calendar parsing instead of Date(string) to avoid timezone drift.
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}
