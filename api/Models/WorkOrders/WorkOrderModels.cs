namespace Naologic_API.Models.WorkOrders;

public sealed record WorkCenterData(string Name);

public sealed record WorkOrderData(
    string Name,
    string WorkCenterId,
    string Status,
    string StartDate,
    string EndDate,
    string PartId,
    decimal Quantity,
    string? PartNumber,
    string? PartName);

public sealed record WorkCenterDocument(string DocId, string DocType, WorkCenterData Data);

public sealed record WorkOrderDocument(string DocId, string DocType, WorkOrderData Data);

public abstract record WorkOrderMutationRequest(
    string Name, string WorkCenterId, string Status, string StartDate, string EndDate,
    string PartId, decimal Quantity);

public sealed record CreateWorkOrderRequest(
    string Name, string WorkCenterId, string Status, string StartDate, string EndDate,
    string PartId, decimal Quantity)
    : WorkOrderMutationRequest(Name, WorkCenterId, Status, StartDate, EndDate, PartId, Quantity);

public sealed record UpdateWorkOrderRequest(
    string Name, string WorkCenterId, string Status, string StartDate, string EndDate,
    string PartId, decimal Quantity)
    : WorkOrderMutationRequest(Name, WorkCenterId, Status, StartDate, EndDate, PartId, Quantity);
