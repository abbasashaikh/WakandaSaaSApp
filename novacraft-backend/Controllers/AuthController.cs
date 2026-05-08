using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NovaCraft.Data;
using NovaCraft.Models;
using NovaCraft.Services;

namespace NovaCraft.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly JwtService _jwt;
    private readonly IConfiguration _config;

    public AuthController(AppDbContext db, JwtService jwt, IConfiguration config)
    {
        _db = db; _jwt = jwt; _config = config;
    }

    // ── Register ──────────────────────────────────────────────────────────────
    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterDto dto)
    {
        if (await _db.Users.AnyAsync(u => u.Email == dto.Email.ToLower()))
            return BadRequest(new { message = "Email already registered." });

        var user = new User
        {
            Name  = dto.Name.Trim(),
            Email = dto.Email.ToLower().Trim(),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password),
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        // Create empty subscription
        _db.Subscriptions.Add(new Subscription { UserId = user.Id });
        await _db.SaveChangesAsync();

        var token = _jwt.GenerateToken(user.Id, user.Email);
        return Ok(new { token, user = new { user.Id, user.Name, user.Email } });
    }

    // ── Login ─────────────────────────────────────────────────────────────────
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginDto dto)
    {
        // Admin login
        if (dto.Email.ToLower() == _config["Admin:Email"]!.ToLower())
        {
            if (dto.Password != _config["Admin:Password"])
                return Unauthorized(new { message = "Invalid credentials." });
            var adminToken = _jwt.GenerateToken(0, dto.Email, isAdmin: true);
            return Ok(new { token = adminToken, user = new { Id = 0, Name = "Admin", Email = dto.Email, isAdmin = true } });
        }

        var user = await _db.Users
            .Include(u => u.Subscription)
            .FirstOrDefaultAsync(u => u.Email == dto.Email.ToLower());

        if (user == null || !BCrypt.Net.BCrypt.Verify(dto.Password, user.PasswordHash))
            return Unauthorized(new { message = "Invalid email or password." });

        var token = _jwt.GenerateToken(user.Id, user.Email);
        return Ok(new
        {
            token,
            user = new
            {
                user.Id, user.Name, user.Email,
                isAdmin = false,
                subscription = user.Subscription == null ? null : new
                {
                    user.Subscription.HasAccess,
                    user.Subscription.PlanName,
                    user.Subscription.CreditsRemaining,
                    planExpiry = user.Subscription.PlanExpiry,
                }
            }
        });
    }

    // ── Get Me ────────────────────────────────────────────────────────────────
    [HttpGet("me")]
    [Microsoft.AspNetCore.Authorization.Authorize]
    public async Task<IActionResult> Me()
    {
        var userId = int.Parse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)!.Value);
        var user = await _db.Users.Include(u => u.Subscription).FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null) return NotFound();
        return Ok(new
        {
            user.Id, user.Name, user.Email,
            subscription = user.Subscription == null ? null : new
            {
                user.Subscription.HasAccess,
                user.Subscription.PlanName,
                user.Subscription.CreditsRemaining,
                planExpiry = user.Subscription.PlanExpiry,
            }
        });
    }
}

public record RegisterDto(string Name, string Email, string Password);
public record LoginDto(string Email, string Password);
