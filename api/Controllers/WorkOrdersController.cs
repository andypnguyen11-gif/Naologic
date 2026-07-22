using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Naologic_API.Models.WorkOrders;
using Naologic_API.Repositories;
using Naologic_API.Services;
using Naologic_API.Validation;

namespace Naologic_API.Controllers;

[ApiController]
[Authorize]
[Route("api")]
public sealed class WorkOrdersController : ControllerBase
{
    private readonly WorkOrdersRepository _repository;
    private readonly WorkOrderInventoryService _inventoryService;

    public WorkOrdersController(WorkOrdersRepository repository, WorkOrderInventoryService inventoryService)
    {
        _repository = repository;
        _inventoryService = inventoryService;
    }

    [HttpGet("work-centers")]
    public async Task<ActionResult<IReadOnlyList<WorkCenterDocument>>> GetWorkCenters(CancellationToken cancellationToken)
    {
        var workCenters = await _repository.GetWorkCentersAsync(cancellationToken);
        return Ok(workCenters);
    }

    [HttpGet("work-orders")]
    public async Task<ActionResult<IReadOnlyList<WorkOrderDocument>>> GetWorkOrders(CancellationToken cancellationToken)
    {
        var workOrders = await _repository.GetWorkOrdersAsync(cancellationToken);
        return Ok(workOrders);
    }

    [Authorize(Policy = "PlannerWriteAccess")]
    [HttpPost("work-orders")]
    public async Task<IResult> CreateWorkOrder([FromBody] CreateWorkOrderRequest request, CancellationToken cancellationToken)
    {
        var validationError = WorkOrderValidators.ValidateWorkOrderRequest(request);
        if (validationError is not null)
        {
            return Results.ValidationProblem(validationError);
        }

        var result = await _inventoryService.CreateAsync(request, cancellationToken);
        if (result.Error is not null)
        {
            return Results.BadRequest(new { message = result.Error.Message, shortages = result.Error.Shortages });
        }
        return Results.Created($"/api/work-orders/{result.Document!.DocId}", result.Document);
    }

    [Authorize(Policy = "PlannerWriteAccess")]
    [HttpPut("work-orders/{id}")]
    public async Task<IResult> UpdateWorkOrder(string id, [FromBody] UpdateWorkOrderRequest request, CancellationToken cancellationToken)
    {
        var validationError = WorkOrderValidators.ValidateWorkOrderRequest(request);
        if (validationError is not null)
        {
            return Results.ValidationProblem(validationError);
        }

        var result = await _inventoryService.UpdateAsync(id, request, cancellationToken);
        if (result.NotFound)
        {
            return Results.NotFound();
        }
        if (result.Error is not null)
        {
            return Results.BadRequest(new { message = result.Error.Message, shortages = result.Error.Shortages });
        }
        return Results.Ok(result.Document);
    }

    [Authorize(Policy = "PlannerWriteAccess")]
    [HttpDelete("work-orders/{id}")]
    public async Task<IResult> DeleteWorkOrder(string id, CancellationToken cancellationToken)
    {
        var result = await _inventoryService.DeleteAsync(id, cancellationToken);
        if (result.NotFound)
        {
            return Results.NotFound();
        }
        if (result.Error is not null)
        {
            return Results.BadRequest(new { message = result.Error.Message, shortages = result.Error.Shortages });
        }
        return Results.NoContent();
    }
}
