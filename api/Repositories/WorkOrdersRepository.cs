using Microsoft.Data.SqlClient;
using Naologic_API.Models.WorkOrders;

namespace Naologic_API.Repositories;

public sealed class WorkOrdersRepository
{
    public static readonly string[] AllowedStatuses = ["open", "in-progress", "complete", "blocked"];
    private readonly string _connectionString;

    public WorkOrdersRepository(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is not configured.");
    }

    public async Task<IReadOnlyList<WorkCenterDocument>> GetWorkCentersAsync(CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT WorkCenterId, Name
            FROM WorkCenters
            ORDER BY WorkCenterId;
            """;

        var workCenters = new List<WorkCenterDocument>();
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            workCenters.Add(new WorkCenterDocument(
                reader.GetString(0),
                "workCenter",
                new WorkCenterData(reader.GetString(1))));
        }

        return workCenters;
    }

    public async Task<IReadOnlyList<WorkOrderDocument>> GetWorkOrdersAsync(CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT wo.WorkOrderId, wo.Name, wo.WorkCenterId, wo.Status, wo.StartDate, wo.EndDate,
                   wo.PartId, wo.Quantity, p.PartNumber, p.Name AS PartName
            FROM WorkOrders wo
            INNER JOIN Parts p ON p.PartId = wo.PartId
            ORDER BY wo.StartDate, wo.WorkOrderId;
            """;

        var workOrders = new List<WorkOrderDocument>();
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            workOrders.Add(new WorkOrderDocument(
                reader.GetString(0),
                "workOrder",
                new WorkOrderData(
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetDateTime(4).ToString("yyyy-MM-dd"),
                    reader.GetDateTime(5).ToString("yyyy-MM-dd"),
                    reader.GetString(6),
                    reader.GetDecimal(7),
                    reader.GetString(8),
                    reader.GetString(9))));
        }

        return workOrders;
    }
}
