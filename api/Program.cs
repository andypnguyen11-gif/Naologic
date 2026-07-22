using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.Tokens;
using Naologic_API.Configuration;
using Naologic_API.Constants;
using Naologic_API.Models.Auth;
using Naologic_API.Repositories;
using Naologic_API.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

var allowedOrigins = builder.Configuration["Cors:AllowedOrigins"]?
    .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    ?? ["http://localhost:4200"];

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod());
});

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        var jwtSettings = builder.Configuration.GetSection(JwtSettings.SectionName).Get<JwtSettings>()
            ?? throw new InvalidOperationException("Jwt settings are not configured.");
        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.SigningKey));

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtSettings.Issuer,
            ValidateAudience = true,
            ValidAudience = jwtSettings.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = signingKey,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };
    });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("PlannerWriteAccess", policy =>
        policy.RequireRole(UserRoles.Admin, UserRoles.Planner));

builder.Services.AddSingleton<WorkOrdersRepository>();
builder.Services.AddSingleton<PlanningRepository>();
builder.Services.AddSingleton<UsersRepository>();
builder.Services.AddSingleton<IPasswordHasher<AppUserAccount>, PasswordHasher<AppUserAccount>>();
builder.Services.AddSingleton<JwtTokenService>();

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapControllers();

app.Run();
