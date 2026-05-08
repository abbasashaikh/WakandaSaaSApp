using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NovaCraft.Data;
using System.Security.Claims;

namespace NovaCraft.Controllers;

[ApiController]
[Route("api/subscription")]
[Authorize]
public class SubscriptionController : ControllerBase
{
    private readonly AppDbContext _db;
    public SubscriptionController(AppDbContext db) => _db = db;

    // ── Used by APK and EXE on every launch ────────────────────────────────
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var sub = await _db.Subscriptions.FirstOrDefaultAsync(s => s.UserId == userId);

        if (sub == null)
            return Ok(new { has_access = false, plan_name = "", credits_remaining = 0, plan_expiry = (string?)null });

        // Auto-expire check
        if (sub.HasAccess && sub.PlanExpiry.HasValue && sub.PlanExpiry < DateTime.UtcNow)
        {
            sub.HasAccess = false;
            await _db.SaveChangesAsync();
        }

        return Ok(new
        {
            has_access        = sub.HasAccess,
            plan_name         = sub.PlanName,
            credits_remaining = sub.CreditsRemaining,
            plan_expiry       = sub.PlanExpiry?.ToString("yyyy-MM-dd"),
        });
    }

    // ── Deduct credits (called by APK/EXE per generation) ──────────────────
    [HttpPost("deduct")]
    public async Task<IActionResult> Deduct([FromBody] DeductDto dto)
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var sub    = await _db.Subscriptions.FirstOrDefaultAsync(s => s.UserId == userId);

        if (sub == null || !sub.HasAccess)
            return Unauthorized(new { message = "No active plan." });

        if (sub.CreditsRemaining < dto.Amount)
            return BadRequest(new { message = "Insufficient credits." });

        sub.CreditsRemaining -= dto.Amount;
        await _db.SaveChangesAsync();

        return Ok(new { credits_remaining = sub.CreditsRemaining });
    }
}

public record DeductDto(int Amount);
