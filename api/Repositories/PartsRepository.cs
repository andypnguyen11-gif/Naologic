using Microsoft.Data.SqlClient;
using Naologic_API.Models.Parts;

namespace Naologic_API.Repositories;

public sealed class PartsRepository
{
    private readonly string _connectionString;

    public PartsRepository(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is not configured.");
    }

    public async Task<IReadOnlyList<BuildablePartDocument>> GetBuildablePartsAsync(CancellationToken cancellationToken)
    {
        // Buildable = has at least one BOM line; mirrors the server-side
        // mutation guard so the picker and the API can never disagree.
        const string sql = """
            SELECT p.PartId, p.PartNumber, p.Name, p.DefaultWorkCenterId
            FROM Parts p
            WHERE EXISTS (SELECT 1 FROM BillOfMaterials b WHERE b.ParentPartId = p.PartId)
            ORDER BY p.Name;
            """;

        var parts = new List<BuildablePartDocument>();
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            parts.Add(new BuildablePartDocument(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3)));
        }

        return parts;
    }
}
