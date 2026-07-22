namespace Naologic_API.Models.Parts;

public sealed record BuildablePartDocument(
    string PartId, string PartNumber, string Name, string? DefaultWorkCenterId);
