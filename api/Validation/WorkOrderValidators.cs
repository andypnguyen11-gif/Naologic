using Naologic_API.Repositories;
using Naologic_API.Models.WorkOrders;

namespace Naologic_API.Validation;

public static class WorkOrderValidators
{
    public static Dictionary<string, string[]>? ValidateWorkOrderRequest(WorkOrderMutationRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            errors["name"] = ["Name is required."];
        }

        if (string.IsNullOrWhiteSpace(request.WorkCenterId))
        {
            errors["workCenterId"] = ["Work center is required."];
        }

        if (string.IsNullOrWhiteSpace(request.PartId))
        {
            errors["partId"] = ["Part is required."];
        }

        if (request.Quantity <= 0)
        {
            errors["quantity"] = ["Quantity must be greater than zero."];
        }

        if (!WorkOrdersRepository.AllowedStatuses.Contains(request.Status))
        {
            errors["status"] = [$"Status must be one of: {string.Join(", ", WorkOrdersRepository.AllowedStatuses)}."];
        }

        if (!DateOnly.TryParse(request.StartDate, out var startDate))
        {
            errors["startDate"] = ["Start date must be a valid ISO date string (yyyy-MM-dd)."];
        }

        if (!DateOnly.TryParse(request.EndDate, out var endDate))
        {
            errors["endDate"] = ["End date must be a valid ISO date string (yyyy-MM-dd)."];
        }

        if (!errors.ContainsKey("startDate") && !errors.ContainsKey("endDate") && startDate > endDate)
        {
            errors["dateRange"] = ["End date must be on or after start date."];
        }

        return errors.Count > 0 ? errors : null;
    }
}
