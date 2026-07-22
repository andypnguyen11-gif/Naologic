import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Injectable, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { NgbDateParserFormatter, NgbDateStruct, NgbDatepickerModule, NgbInputDatepicker } from '@ng-bootstrap/ng-bootstrap';
import { NgSelectModule } from '@ng-select/ng-select';
import { BuildablePart, WorkCenterDocument, WorkOrderDocument, WorkOrderStatus } from '../../../../models/work-orders.models';

export interface WorkOrderPanelSubmitEvent {
  mode: 'create' | 'edit';
  orderId: string | null;
  value: {
    name: string;
    status: WorkOrderStatus;
    partId: string;
    quantity: number;
    workCenterId: string;
    startDate: string;
    endDate: string;
  };
}

interface StatusOption {
  label: string;
  value: WorkOrderStatus;
}

@Injectable()
class DotDateParserFormatter extends NgbDateParserFormatter {
  parse(value: string): NgbDateStruct | null {
    if (!value) {
      return null;
    }
    const parts = value.trim().split('.');
    if (parts.length !== 3) {
      return null;
    }
    const month = Number(parts[0]);
    const day = Number(parts[1]);
    const year = Number(parts[2]);
    if (!month || !day || !year) {
      return null;
    }
    return { year, month, day };
  }

  format(date: NgbDateStruct | null): string {
    if (!date) {
      return '';
    }
    const month = `${date.month}`.padStart(2, '0');
    const day = `${date.day}`.padStart(2, '0');
    return `${month}.${day}.${date.year}`;
  }
}

@Component({
  selector: 'app-work-order-panel',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, NgSelectModule, NgbDatepickerModule],
  providers: [{ provide: NgbDateParserFormatter, useClass: DotDateParserFormatter }],
  templateUrl: './work-order-panel.html',
  styleUrl: './work-order-panel.scss',
})
export class WorkOrderPanel implements OnChanges {
  private readonly panelTransitionMs = 220;
  private closeTimerId: ReturnType<typeof setTimeout> | null = null;
  @Input() open = false;
  @Input() mode: 'create' | 'edit' = 'create';
  @Input() order: WorkOrderDocument | null = null;
  @Input() buildableParts: BuildablePart[] = [];
  @Input() workCenters: WorkCenterDocument[] = [];
  @Input() defaultWorkCenterId: string | null = null;
  @Input() defaultStartDate: string | null = null;
  @Input() saveError: string | null = null;
  @Output() closePanel = new EventEmitter<void>();
  @Output() saveOrder = new EventEmitter<WorkOrderPanelSubmitEvent>();
  @ViewChild('startDatePicker') private startDatePicker?: NgbInputDatepicker;
  @ViewChild('endDatePicker') private endDatePicker?: NgbInputDatepicker;

  protected readonly statusOptions: StatusOption[] = [
    { label: 'Open', value: 'open' },
    { label: 'In Progress', value: 'in-progress' },
    { label: 'Complete', value: 'complete' },
    { label: 'Blocked', value: 'blocked' }
  ];

  protected readonly form;
  protected shouldRender = false;
  protected isClosing = false;
  // Keep the validator as an arrow function so it preserves component context
  // when Angular executes it from the form group configuration.
  private readonly dateRangeValidator = (control: AbstractControl): ValidationErrors | null => {
    const startDate = control.get('startDate')?.value as NgbDateStruct | null;
    const endDate = control.get('endDate')?.value as NgbDateStruct | null;
    if (!startDate || !endDate) {
      return null;
    }

    return this.compareDateStruct(startDate, endDate) <= 0 ? null : { dateRange: true };
  };

  constructor(
    private readonly formBuilder: FormBuilder
  ) {
    this.form = this.formBuilder.group(
      {
        name: ['', [Validators.required]],
        status: [this.statusOptions[0].value, [Validators.required]],
        partId: [null as string | null, [Validators.required]],
        quantity: [1, [Validators.required, Validators.min(1)]],
        workCenterId: [null as string | null, [Validators.required]],
        startDate: [null as NgbDateStruct | null, [Validators.required]],
        endDate: [null as NgbDateStruct | null, [Validators.required]]
      },
      { validators: [this.dateRangeValidator] }
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      if (this.open) {
        if (this.closeTimerId) {
          clearTimeout(this.closeTimerId);
          this.closeTimerId = null;
        }
        this.shouldRender = true;
        this.isClosing = false;
      } else if (this.shouldRender) {
        // Keep the panel mounted briefly so the slide/fade exit animation can finish.
        this.isClosing = true;
        this.closeTimerId = setTimeout(() => {
          if (!this.open) {
            this.shouldRender = false;
            this.isClosing = false;
          }
          this.closeTimerId = null;
        }, this.panelTransitionMs);
      }
    }

    if (!this.open) {
      return;
    }

    if (changes['open'] || changes['mode'] || changes['order'] || changes['defaultStartDate']) {
      // Defer once so all bound @Input values settle before hydrating controls.
      queueMicrotask(() => {
        if (this.open) {
          this.resetFormFromInputs();
        }
      });
    }
  }

  get title(): string {
    return 'Work Order Details';
  }

  get actionLabel(): string {
    return this.mode === 'edit' ? 'Save' : 'Create';
  }

  protected getStatusLabel(item: StatusOption | WorkOrderStatus | null): string {
    if (!item) {
      return '';
    }
    if (typeof item === 'string') {
      return this.statusOptions.find((option) => option.value === item)?.label ?? '';
    }
    return item.label;
  }

  protected getStatusValue(item: StatusOption | WorkOrderStatus | null): WorkOrderStatus | '' {
    if (!item) {
      return '';
    }
    return typeof item === 'string' ? item : item.value;
  }

  protected isFieldInvalid(fieldName: 'name' | 'status' | 'partId' | 'quantity' | 'workCenterId' | 'startDate' | 'endDate'): boolean {
    const field = this.form.get(fieldName);
    return !!field && field.invalid && (field.dirty || field.touched);
  }

  protected get showDateRangeError(): boolean {
    return !!this.form.errors?.['dateRange'] && (this.form.dirty || this.form.touched);
  }

  // ng-select's (change) hands back the item object; tests call with a plain id.
  protected onPartSelected(part: BuildablePart | string | null): void {
    const partId = typeof part === 'string' ? part : (part?.partId ?? null);
    const match = this.buildableParts.find((candidate) => candidate.partId === partId);
    // Only fill an empty work center; a value seeded from the clicked timeline
    // row (or chosen by the user) must not be overwritten by the part default.
    if (match?.defaultWorkCenterId && !this.form.getRawValue().workCenterId) {
      this.form.patchValue({ workCenterId: match.defaultWorkCenterId });
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    if (!this.open) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (target.closest('.wo-datepicker-popup') || target.closest('.wo-date-control')) {
      return;
    }
    // Datepickers are managed separately from the panel so outside clicks close
    // just the calendars without interfering with the drawer itself.
    this.startDatePicker?.close();
    this.endDatePicker?.close();
  }

  onClose(): void {
    this.closePanel.emit();
  }

  protected onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const formValue = this.form.getRawValue();
    const startDate = this.toIsoDateString(formValue.startDate);
    const endDate = this.toIsoDateString(formValue.endDate);
    if (!startDate || !endDate) {
      this.form.markAllAsTouched();
      return;
    }
    this.saveOrder.emit({
      mode: this.mode,
      orderId: this.order?.docId ?? null,
      value: {
        name: formValue.name ?? '',
        status: (formValue.status as WorkOrderStatus | null) ?? 'open',
        partId: formValue.partId ?? '',
        quantity: Number(formValue.quantity ?? 0),
        workCenterId: formValue.workCenterId ?? '',
        startDate,
        endDate
      }
    });
  }

  private resetFormFromInputs(): void {
    if (this.mode === 'edit' && this.order) {
      this.form.reset({
        name: this.order.data.name,
        status: this.order.data.status,
        partId: this.order.data.partId,
        quantity: this.order.data.quantity,
        workCenterId: this.order.data.workCenterId,
        startDate: this.toDateStruct(this.order.data.startDate),
        endDate: this.toDateStruct(this.order.data.endDate)
      });
    } else {
      // Create mode starts from the clicked timeline date when available, then
      // defaults the end date one week later to match the exercise behavior.
      const baseStartDate = this.defaultStartDate ?? this.formatDate(new Date());
      const startDate = this.isValidDateString(baseStartDate)
        ? baseStartDate
        : this.formatDate(new Date());
      const end = this.parseDate(startDate);
      end.setDate(end.getDate() + 7);
      this.form.reset({
        name: '',
        status: this.statusOptions[0].value,
        partId: null,
        quantity: 1,
        workCenterId: this.defaultWorkCenterId,
        startDate: this.toDateStruct(startDate),
        endDate: this.toDateStruct(this.formatDate(end))
      });
    }

    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDate(dateString: string): Date {
    return new Date(`${dateString}T00:00:00`);
  }

  private isValidDateString(dateString: string): boolean {
    const parsed = this.parseDate(dateString);
    return !Number.isNaN(parsed.getTime());
  }

  private toDateStruct(dateString: string): NgbDateStruct {
    const parsed = this.parseDate(dateString);
    return {
      year: parsed.getFullYear(),
      month: parsed.getMonth() + 1,
      day: parsed.getDate()
    };
  }

  private toIsoDateString(value: NgbDateStruct | null): string | null {
    if (!value) {
      return null;
    }
    const year = `${value.year}`;
    const month = `${value.month}`.padStart(2, '0');
    const day = `${value.day}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private compareDateStruct(a: NgbDateStruct, b: NgbDateStruct): number {
    // Compare calendar parts directly so validation stays independent of browser
    // timezone parsing and matches the datepicker's local date semantics.
    if (a.year !== b.year) {
      return a.year - b.year;
    }
    if (a.month !== b.month) {
      return a.month - b.month;
    }
    return a.day - b.day;
  }
}
