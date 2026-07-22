using Microsoft.Data.SqlClient;
using Naologic_API.Models.WorkOrders;

namespace Naologic_API.Services;

public sealed record WorkOrderMutationResult(
    WorkOrderDocument? Document, PlanError? Error, bool NotFound = false);

// Owns every work-order mutation. Loads order/BOM/inventory state under UPDLOCK,
// asks InventoryPlanner for the deltas, and applies deltas + the order row change
// in one transaction so planning data can never drift from the orders.
public sealed class WorkOrderInventoryService
{
    private sealed record PartInfo(string PartId, string PartNumber, string Name);

    private readonly string _connectionString;

    public WorkOrderInventoryService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is not configured.");
    }

    public async Task<WorkOrderMutationResult> CreateAsync(
        CreateWorkOrderRequest request, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);

        var guardError = await ValidateReferencesAsync(connection, transaction, request, cancellationToken);
        if (guardError is not null)
        {
            return new WorkOrderMutationResult(null, guardError);
        }

        var newState = new OrderState(request.PartId, request.Quantity, request.Status);
        var planError = await PlanAndApplyAsync(connection, transaction, null, newState, cancellationToken);
        if (planError is not null)
        {
            return new WorkOrderMutationResult(null, planError);
        }

        var workOrderId = $"wo-{Guid.NewGuid():N}"[..11];
        const string insertSql = """
            INSERT INTO WorkOrders (WorkOrderId, Name, WorkCenterId, PartId, Quantity, Status, StartDate, EndDate)
            VALUES (@workOrderId, @name, @workCenterId, @partId, @quantity, @status, @startDate, @endDate);
            """;
        await using (var command = new SqlCommand(insertSql, connection, transaction))
        {
            command.Parameters.AddWithValue("@workOrderId", workOrderId);
            AddMutationParameters(command, request);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        var part = await GetPartAsync(connection, transaction, request.PartId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new WorkOrderMutationResult(BuildDocument(workOrderId, request, part), null);
    }

    public async Task<WorkOrderMutationResult> UpdateAsync(
        string id, UpdateWorkOrderRequest request, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);

        var oldState = await GetOrderStateAsync(connection, transaction, id, cancellationToken);
        if (oldState is null)
        {
            return new WorkOrderMutationResult(null, null, NotFound: true);
        }

        var guardError = await ValidateReferencesAsync(connection, transaction, request, cancellationToken);
        if (guardError is not null)
        {
            return new WorkOrderMutationResult(null, guardError);
        }

        var newState = new OrderState(request.PartId, request.Quantity, request.Status);
        var planError = await PlanAndApplyAsync(connection, transaction, oldState, newState, cancellationToken);
        if (planError is not null)
        {
            return new WorkOrderMutationResult(null, planError);
        }

        const string updateSql = """
            UPDATE WorkOrders
            SET Name = @name,
                WorkCenterId = @workCenterId,
                PartId = @partId,
                Quantity = @quantity,
                Status = @status,
                StartDate = @startDate,
                EndDate = @endDate
            WHERE WorkOrderId = @workOrderId;
            """;
        await using (var command = new SqlCommand(updateSql, connection, transaction))
        {
            command.Parameters.AddWithValue("@workOrderId", id);
            AddMutationParameters(command, request);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        var part = await GetPartAsync(connection, transaction, request.PartId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new WorkOrderMutationResult(BuildDocument(id, request, part), null);
    }

    public async Task<WorkOrderMutationResult> DeleteAsync(string id, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);

        var oldState = await GetOrderStateAsync(connection, transaction, id, cancellationToken);
        if (oldState is null)
        {
            return new WorkOrderMutationResult(null, null, NotFound: true);
        }

        var planError = await PlanAndApplyAsync(connection, transaction, oldState, null, cancellationToken);
        if (planError is not null)
        {
            return new WorkOrderMutationResult(null, planError);
        }

        const string deleteSql = "DELETE FROM WorkOrders WHERE WorkOrderId = @workOrderId;";
        await using (var command = new SqlCommand(deleteSql, connection, transaction))
        {
            command.Parameters.AddWithValue("@workOrderId", id);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return new WorkOrderMutationResult(null, null);
    }

    // ---- request-level reference guards -------------------------------------

    private static async Task<PlanError?> ValidateReferencesAsync(
        SqlConnection connection, SqlTransaction transaction,
        WorkOrderMutationRequest request, CancellationToken cancellationToken)
    {
        const string workCenterSql = "SELECT COUNT(1) FROM WorkCenters WHERE WorkCenterId = @id;";
        await using (var command = new SqlCommand(workCenterSql, connection, transaction))
        {
            command.Parameters.AddWithValue("@id", request.WorkCenterId);
            if ((int)await command.ExecuteScalarAsync(cancellationToken) == 0)
            {
                return new PlanError("Unknown work center.");
            }
        }

        var part = await GetPartAsync(connection, transaction, request.PartId, cancellationToken);
        if (part is null)
        {
            return new PlanError("Unknown part.");
        }

        // Mirror of the picker rule: only parts with a BOM are producible.
        var bom = await GetBomLinesAsync(connection, transaction, request.PartId, cancellationToken);
        if (bom.Count == 0)
        {
            return new PlanError("Selected part has no bill of materials and cannot be produced.");
        }

        return null;
    }

    // ---- planner orchestration ----------------------------------------------

    private static async Task<PlanError?> PlanAndApplyAsync(
        SqlConnection connection, SqlTransaction transaction,
        OrderState? oldState, OrderState? newState, CancellationToken cancellationToken)
    {
        var parentIds = new List<string>();
        if (oldState is not null)
        {
            parentIds.Add(oldState.PartId);
        }
        if (newState is not null && !parentIds.Contains(newState.PartId))
        {
            parentIds.Add(newState.PartId);
        }

        var bomByParent = new Dictionary<string, IReadOnlyList<BomLine>>();
        foreach (var parentId in parentIds)
        {
            bomByParent[parentId] = await GetBomLinesAsync(connection, transaction, parentId, cancellationToken);
        }

        var affectedIds = bomByParent.Values
            .SelectMany(lines => lines.Select(line => line.ComponentPartId))
            .Concat(parentIds)
            .Distinct()
            .ToList();

        var inventory = await GetInventoryAsync(connection, transaction, affectedIds, cancellationToken);
        var partNames = await GetPartNamesAsync(connection, transaction, affectedIds, cancellationToken);

        var result = InventoryPlanner.PlanTransition(oldState, newState, bomByParent, inventory, partNames);
        if (result.Error is not null)
        {
            return result.Error;
        }

        await ApplyDeltasAsync(connection, transaction, result.Deltas!, cancellationToken);
        return null;
    }

    private static async Task ApplyDeltasAsync(
        SqlConnection connection, SqlTransaction transaction,
        IReadOnlyDictionary<string, InventoryDelta> deltas, CancellationToken cancellationToken)
    {
        foreach (var (partId, delta) in deltas)
        {
            const string updateSql = """
                UPDATE Inventory
                SET QuantityOnHand = QuantityOnHand + @onHand,
                    QuantityAllocated = QuantityAllocated + @allocated
                WHERE PartId = @partId;
                """;
            await using var updateCommand = new SqlCommand(updateSql, connection, transaction);
            updateCommand.Parameters.AddWithValue("@onHand", delta.OnHand);
            updateCommand.Parameters.AddWithValue("@allocated", delta.Allocated);
            updateCommand.Parameters.AddWithValue("@partId", partId);
            var rows = await updateCommand.ExecuteNonQueryAsync(cancellationToken);

            if (rows == 0)
            {
                // Row on demand — the planner guarantees the resulting values are >= 0.
                var inventoryId = $"inv-{Guid.NewGuid():N}"[..12];
                const string insertSql = """
                    INSERT INTO Inventory (InventoryId, PartId, QuantityOnHand, QuantityAllocated, QuantityOnOrder, SafetyStock)
                    VALUES (@inventoryId, @partId, @onHand, @allocated, 0, 0);
                    """;
                await using var insertCommand = new SqlCommand(insertSql, connection, transaction);
                insertCommand.Parameters.AddWithValue("@inventoryId", inventoryId);
                insertCommand.Parameters.AddWithValue("@partId", partId);
                insertCommand.Parameters.AddWithValue("@onHand", delta.OnHand);
                insertCommand.Parameters.AddWithValue("@allocated", delta.Allocated);
                await insertCommand.ExecuteNonQueryAsync(cancellationToken);
            }
        }
    }

    // ---- loaders -------------------------------------------------------------

    private static async Task<OrderState?> GetOrderStateAsync(
        SqlConnection connection, SqlTransaction transaction, string id, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT PartId, Quantity, Status
            FROM WorkOrders WITH (UPDLOCK)
            WHERE WorkOrderId = @id;
            """;
        await using var command = new SqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("@id", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }
        return new OrderState(reader.GetString(0), reader.GetDecimal(1), reader.GetString(2));
    }

    private static async Task<PartInfo?> GetPartAsync(
        SqlConnection connection, SqlTransaction transaction, string partId, CancellationToken cancellationToken)
    {
        const string sql = "SELECT PartId, PartNumber, Name FROM Parts WHERE PartId = @partId;";
        await using var command = new SqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("@partId", partId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }
        return new PartInfo(reader.GetString(0), reader.GetString(1), reader.GetString(2));
    }

    private static async Task<IReadOnlyList<BomLine>> GetBomLinesAsync(
        SqlConnection connection, SqlTransaction transaction, string parentPartId, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT ComponentPartId, QuantityPer
            FROM BillOfMaterials
            WHERE ParentPartId = @parentPartId;
            """;
        var lines = new List<BomLine>();
        await using var command = new SqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("@parentPartId", parentPartId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            lines.Add(new BomLine(reader.GetString(0), reader.GetDecimal(1)));
        }
        return lines;
    }

    private static async Task<IReadOnlyDictionary<string, InventoryQuantities>> GetInventoryAsync(
        SqlConnection connection, SqlTransaction transaction,
        IReadOnlyList<string> partIds, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, InventoryQuantities>();
        if (partIds.Count == 0)
        {
            return result;
        }

        const string sqlFormat = """
            SELECT PartId, QuantityOnHand, QuantityAllocated
            FROM Inventory WITH (UPDLOCK)
            WHERE PartId IN ({0});
            """;
        await using var command = CreatePartIdInCommand(connection, transaction, sqlFormat, partIds);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result[reader.GetString(0)] = new InventoryQuantities(reader.GetDecimal(1), reader.GetDecimal(2));
        }
        return result;
    }

    private static async Task<IReadOnlyDictionary<string, string>> GetPartNamesAsync(
        SqlConnection connection, SqlTransaction transaction,
        IReadOnlyList<string> partIds, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, string>();
        if (partIds.Count == 0)
        {
            return result;
        }

        const string sqlFormat = "SELECT PartId, Name FROM Parts WHERE PartId IN ({0});";
        await using var command = CreatePartIdInCommand(connection, transaction, sqlFormat, partIds);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result[reader.GetString(0)] = reader.GetString(1);
        }
        return result;
    }

    // Builds a command whose {0} placeholder is an IN list of @p0..@pN parameters,
    // one per part id, so callers never concatenate ids into SQL.
    private static SqlCommand CreatePartIdInCommand(
        SqlConnection connection, SqlTransaction transaction,
        string sqlFormat, IReadOnlyList<string> partIds)
    {
        var parameterNames = partIds.Select((_, index) => $"@p{index}");
        var command = new SqlCommand(
            string.Format(sqlFormat, string.Join(", ", parameterNames)), connection, transaction);
        for (var i = 0; i < partIds.Count; i++)
        {
            command.Parameters.AddWithValue($"@p{i}", partIds[i]);
        }
        return command;
    }

    // ---- helpers -------------------------------------------------------------

    private static void AddMutationParameters(SqlCommand command, WorkOrderMutationRequest request)
    {
        command.Parameters.AddWithValue("@name", request.Name.Trim());
        command.Parameters.AddWithValue("@workCenterId", request.WorkCenterId);
        command.Parameters.AddWithValue("@partId", request.PartId);
        command.Parameters.AddWithValue("@quantity", request.Quantity);
        command.Parameters.AddWithValue("@status", request.Status);
        command.Parameters.AddWithValue("@startDate", DateOnly.Parse(request.StartDate).ToDateTime(TimeOnly.MinValue));
        command.Parameters.AddWithValue("@endDate", DateOnly.Parse(request.EndDate).ToDateTime(TimeOnly.MinValue));
    }

    private static WorkOrderDocument BuildDocument(
        string workOrderId, WorkOrderMutationRequest request, PartInfo? part) =>
        new(workOrderId, "workOrder", new WorkOrderData(
            request.Name.Trim(),
            request.WorkCenterId,
            request.Status,
            request.StartDate,
            request.EndDate,
            request.PartId,
            request.Quantity,
            part?.PartNumber,
            part?.Name));
}
