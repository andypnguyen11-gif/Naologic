import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { provideHighcharts } from 'highcharts-angular';
import { PlanningPage } from './planning-page';
import { PlanningService } from '../../../services/planning.service';
import { ComponentGapDocument } from '../../../models/planning.models';

describe('PlanningPage', () => {
  const planningService = jasmine.createSpyObj<PlanningService>('PlanningService', ['getComponentGaps']);

  const componentGaps: ComponentGapDocument[] = [
    {
      componentPartId: 'part-tire-26',
      partNumber: 'TIRE-26',
      componentName: '26in Tractor Tire',
      partType: 'Purchased',
      workCenterId: null,
      workCenterName: null,
      quantityPer: 4,
      targetQuantity: 10,
      quantityRequired: 40,
      quantityOnHand: 30,
      quantityAllocated: 12,
      quantityOnOrder: 5,
      quantityAvailable: 18,
      shortage: 22,
      standardBuildDays: 0,
      standardLeadDays: 7,
      projectedReadyDays: 7
    },
    {
      componentPartId: 'part-wheel-assembly',
      partNumber: 'ASM-310',
      componentName: 'Wheel Assembly',
      partType: 'Manufactured',
      workCenterId: 'wc-005',
      workCenterName: 'Wheel Build Line',
      quantityPer: 4,
      targetQuantity: 10,
      quantityRequired: 40,
      quantityOnHand: 40,
      quantityAllocated: 3,
      quantityOnOrder: 0,
      quantityAvailable: 37,
      shortage: 3,
      standardBuildDays: 2,
      standardLeadDays: 0,
      projectedReadyDays: 2
    }
  ];

  beforeEach(async () => {
    planningService.getComponentGaps.calls.reset();
    planningService.getComponentGaps.and.returnValue(of(componentGaps));

    await TestBed.configureTestingModule({
      imports: [PlanningPage],
      providers: [
        provideHighcharts(),
        { provide: PlanningService, useValue: planningService }
      ]
    }).compileComponents();
  });

  it('should include an Allocated column between Available and On Order in the grid CSV export', async () => {
    const fixture = TestBed.createComponent(PlanningPage);
    fixture.detectChanges();
    await fixture.whenStable();

    let capturedBlob: Blob | null = null;
    spyOn(URL, 'createObjectURL').and.callFake((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock-url';
    });
    spyOn(URL, 'revokeObjectURL').and.stub();
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub();

    const component = fixture.componentInstance as any;
    component.exportGridCsv();

    expect(capturedBlob).not.toBeNull();
    const csvText = await capturedBlob!.text();
    const [headerLine, ...rowLines] = csvText.split('\r\n');
    const headers = headerLine.split(',').map((value) => value.replace(/^"|"$/g, ''));

    const availableIndex = headers.indexOf('Available');
    const allocatedIndex = headers.indexOf('Allocated');
    const onOrderIndex = headers.indexOf('On Order');

    expect(allocatedIndex).toBeGreaterThan(-1);
    expect(allocatedIndex).toBe(availableIndex + 1);
    expect(onOrderIndex).toBe(allocatedIndex + 1);

    const firstRow = rowLines[0].split(',').map((value) => value.replace(/^"|"$/g, ''));
    const secondRow = rowLines[1].split(',').map((value) => value.replace(/^"|"$/g, ''));

    expect(firstRow[allocatedIndex]).toBe(`${componentGaps[0].quantityAllocated}`);
    expect(secondRow[allocatedIndex]).toBe(`${componentGaps[1].quantityAllocated}`);
  });

  it('should render an Allocated header after Available and show each row quantityAllocated value', async () => {
    const fixture = TestBed.createComponent(PlanningPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const headerCells = Array.from(
      fixture.nativeElement.querySelectorAll('table.planning-table thead th')
    ) as HTMLTableCellElement[];
    const headerLabels = headerCells.map((cell) => cell.textContent?.trim());

    const availableIndex = headerLabels.indexOf('Available');
    const allocatedIndex = headerLabels.indexOf('Allocated');

    expect(availableIndex).toBeGreaterThan(-1);
    expect(allocatedIndex).toBe(availableIndex + 1);

    const bodyRows = Array.from(
      fixture.nativeElement.querySelectorAll('table.planning-table tbody tr')
    ) as HTMLTableRowElement[];

    expect(bodyRows.length).toBe(componentGaps.length);

    bodyRows.forEach((row, rowIndex) => {
      const cells = Array.from(row.querySelectorAll('td')) as HTMLTableCellElement[];
      expect(cells[allocatedIndex].textContent?.trim()).toBe(`${componentGaps[rowIndex].quantityAllocated}`);
    });
  });
});
