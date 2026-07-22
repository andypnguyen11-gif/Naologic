import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { WorkOrdersPage } from './work-orders-page';
import { WorkOrdersService } from '../../../services/work-orders.service';
import { AuthService } from '../../../auth/auth.service';

describe('WorkOrdersPage', () => {
  const workOrdersService = jasmine.createSpyObj<WorkOrdersService>('WorkOrdersService', [
    'getWorkCenters',
    'getWorkOrders',
    'getBuildableParts',
    'createWorkOrder',
    'updateWorkOrder',
    'deleteWorkOrder'
  ]);

  const authService = jasmine.createSpyObj<AuthService>('AuthService', ['currentUser', 'logout', 'canManageWorkOrders']);

  beforeEach(async () => {
    workOrdersService.getWorkCenters.calls.reset();
    workOrdersService.getWorkOrders.calls.reset();
    workOrdersService.getBuildableParts.calls.reset();
    authService.currentUser.calls.reset();
    authService.logout.calls.reset();
    authService.canManageWorkOrders.calls.reset();

    workOrdersService.getWorkCenters.and.returnValue(of([
      { docId: 'wc-005', docType: 'workCenter', data: { name: 'Wheel Build Line' } }
    ]));
    workOrdersService.getWorkOrders.and.returnValue(of([
      {
        docId: 'wo-001',
        docType: 'workOrder',
        data: {
          name: 'Order 1',
          workCenterId: 'wc-005',
          partId: 'part-wheel-assembly',
          quantity: 8,
          status: 'open',
          startDate: '2026-03-01',
          endDate: '2026-03-05',
          partNumber: 'ASM-310',
          partName: 'Wheel Assembly'
        }
      }
    ]));
    workOrdersService.getBuildableParts.and.returnValue(of([
      { partId: 'part-wheel-assembly', partNumber: 'ASM-310', name: 'Wheel Assembly', defaultWorkCenterId: 'wc-005' }
    ]));
    authService.currentUser.and.returnValue({
      userId: '1',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      role: 'Admin'
    });
    authService.canManageWorkOrders.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [WorkOrdersPage],
      providers: [
        provideRouter([]),
        { provide: WorkOrdersService, useValue: workOrdersService },
        { provide: AuthService, useValue: authService }
      ]
    }).compileComponents();
  });

  it('should load work centers, work orders, and buildable parts on init', async () => {
    const fixture = TestBed.createComponent(WorkOrdersPage);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance as any;
    expect(component.workCenters.length).toBe(1);
    expect(component.workOrders.length).toBe(1);
    expect(component.buildableParts.length).toBe(1);
  });

  it('should open create mode when a timeline create event occurs', async () => {
    const fixture = TestBed.createComponent(WorkOrdersPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance as any;

    component.onCreateWorkOrder({ workCenterId: 'wc-005', startDate: '2026-03-10' });

    expect(component.isPanelOpen).toBeTrue();
    expect(component.panelMode).toBe('create');
    expect(component.pendingCreateWorkCenterId).toBe('wc-005');
  });

  it('should format shortage errors from the API into a readable message', async () => {
    const fixture = TestBed.createComponent(WorkOrdersPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance as any;

    const error = new HttpErrorResponse({
      status: 400,
      error: {
        message: 'Cannot complete: insufficient component inventory.',
        shortages: [
          { partId: 'part-tire-26', partName: '26in Tractor Tire', requiredQty: 8, onHand: 5, shortBy: 3 }
        ]
      }
    });

    const message = component.buildSaveErrorMessage(error, 'fallback');

    expect(message).toContain('Cannot complete');
    expect(message).toContain('26in Tractor Tire: need 8, on hand 5 (short 3)');
  });

  it('should log out through the auth service', async () => {
    const fixture = TestBed.createComponent(WorkOrdersPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance as any;

    component.onLogout();

    expect(authService.logout).toHaveBeenCalled();
  });
});
