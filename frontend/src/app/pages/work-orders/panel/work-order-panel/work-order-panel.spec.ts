import { TestBed } from '@angular/core/testing';
import { WorkOrderPanel } from './work-order-panel';

describe('WorkOrderPanel', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkOrderPanel]
    }).compileComponents();
  });

  function createComponent(): any {
    const fixture = TestBed.createComponent(WorkOrderPanel);
    const component = fixture.componentInstance as any;
    component.buildableParts = [
      { partId: 'part-tractor-1000', partNumber: 'FG-1000', name: 'Tractor Model 1000', defaultWorkCenterId: 'wc-003' },
      { partId: 'part-wheel-assembly', partNumber: 'ASM-310', name: 'Wheel Assembly', defaultWorkCenterId: 'wc-005' }
    ];
    component.workCenters = [
      { docId: 'wc-003', docType: 'workCenter', data: { name: 'Final Assembly' } },
      { docId: 'wc-005', docType: 'workCenter', data: { name: 'Wheel Build Line' } }
    ];
    return component;
  }

  it('should create', () => {
    expect(createComponent()).toBeTruthy();
  });

  it('should mark the form invalid when end date is before start date', () => {
    const component = createComponent();
    component.form.setValue({
      name: 'Order 1',
      status: 'open',
      partId: 'part-wheel-assembly',
      quantity: 5,
      workCenterId: 'wc-005',
      startDate: { year: 2026, month: 3, day: 10 },
      endDate: { year: 2026, month: 3, day: 9 }
    });

    expect(component.form.errors?.['dateRange']).toBeTrue();
  });

  it('should require a part and a positive quantity', () => {
    const component = createComponent();
    component.form.patchValue({ partId: null, quantity: 0 });

    expect(component.form.get('partId')?.invalid).toBeTrue();
    expect(component.form.get('quantity')?.invalid).toBeTrue();
  });

  it('should default the work center from the selected part when none is set', () => {
    const component = createComponent();
    component.form.patchValue({ workCenterId: null });

    component.onPartSelected('part-wheel-assembly');

    expect(component.form.get('workCenterId')?.value).toBe('wc-005');
  });

  it('should not overwrite a work center seeded from the clicked timeline row', () => {
    const component = createComponent();
    component.form.patchValue({ workCenterId: 'wc-003' });

    component.onPartSelected('part-wheel-assembly');

    expect(component.form.get('workCenterId')?.value).toBe('wc-003');
  });

  it('should emit a save event with part, quantity, work center, and ISO dates', () => {
    const component = createComponent();
    spyOn(component.saveOrder, 'emit');

    component.mode = 'create';
    component.form.setValue({
      name: 'Order 1',
      status: 'open',
      partId: 'part-wheel-assembly',
      quantity: 8,
      workCenterId: 'wc-005',
      startDate: { year: 2026, month: 3, day: 10 },
      endDate: { year: 2026, month: 3, day: 12 }
    });

    component.onSubmit();

    expect(component.saveOrder.emit).toHaveBeenCalledWith({
      mode: 'create',
      orderId: null,
      value: {
        name: 'Order 1',
        status: 'open',
        partId: 'part-wheel-assembly',
        quantity: 8,
        workCenterId: 'wc-005',
        startDate: '2026-03-10',
        endDate: '2026-03-12'
      }
    });
  });
});
