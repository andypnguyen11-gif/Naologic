export type WorkOrderStatus = 'open' | 'in-progress' | 'complete' | 'blocked';

export interface BaseDocument<T> {
  docId: string;
  docType: string;
  data: T;
}

export interface WorkCenterData {
  name: string;
}

export interface WorkOrderData {
  name: string;
  workCenterId: string;
  partId: string;
  quantity: number;
  status: WorkOrderStatus;
  startDate: string;
  endDate: string;
  partNumber?: string | null;
  partName?: string | null;
}

export interface BuildablePart {
  partId: string;
  partNumber: string;
  name: string;
  defaultWorkCenterId: string | null;
}

export interface WorkOrderShortage {
  partId: string;
  partName: string;
  requiredQty: number;
  onHand: number;
  shortBy: number;
}

export interface WorkOrderErrorBody {
  message?: string;
  shortages?: WorkOrderShortage[];
}

export type WorkCenterDocument = BaseDocument<WorkCenterData> & {
  docType: 'workCenter';
};

export type WorkOrderDocument = BaseDocument<WorkOrderData> & {
  docType: 'workOrder';
};
