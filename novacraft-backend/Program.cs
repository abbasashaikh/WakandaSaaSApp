using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using NovaCraft.Data;
using NovaCraft.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Services ──────────────────────────────────────────────────────────────────
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();

// SQLite
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection")));

// JWT
var jwtKey = builder.Configuration["Jwt:Key"]!;
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer           = true,
            ValidateAudience         = true,
            ValidateLifetime         = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer              = builder.Configuration["Jwt:Issuer"],
            ValidAudience            = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey         = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddScoped<JwtService>();
builder.Services.AddScoped<EmailService>();

// CORS — allow React frontend
builder.Services.AddCors(opt => opt.AddPolicy("Frontend", policy =>
    policy.WithOrigins(
        builder.Configuration["Frontend:Url"] ?? "http://localhost:3151",
        "https://novacraft.azurewebsites.net"
    )
    .AllowAnyHeader()
    .AllowAnyMethod()
));

var app = builder.Build();

// ── Migrate DB on startup ─────────────────────────────────────────────────────
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

// Health check
app.MapGet("/health", () => new { status = "ok", app = "NovaCraft API", version = "1.0" });

Console.WriteLine("✅ NovaCraft API running");
Console.WriteLine("   Endpoints:");
Console.WriteLine("   POST /api/auth/register");
Console.WriteLine("   POST /api/auth/login");
Console.WriteLine("   GET  /api/subscription/status  ← APK/EXE check access here");
Console.WriteLine("   GET  /health");

app.Run();
