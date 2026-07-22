using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Naologic_API.Models.Parts;
using Naologic_API.Repositories;

namespace Naologic_API.Controllers;

[ApiController]
[Authorize]
[Route("api/parts")]
public sealed class PartsController : ControllerBase
{
    private readonly PartsRepository _repository;

    public PartsController(PartsRepository repository)
    {
        _repository = repository;
    }

    [HttpGet("buildable")]
    public async Task<ActionResult<IReadOnlyList<BuildablePartDocument>>> GetBuildableParts(CancellationToken cancellationToken)
    {
        var parts = await _repository.GetBuildablePartsAsync(cancellationToken);
        return Ok(parts);
    }
}
