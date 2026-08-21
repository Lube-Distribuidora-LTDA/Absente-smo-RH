# Deploy completo do Schema no Supabase
param(
    [string]$token = $env:SUPABASE_ACCESS_TOKEN,
    [string]$projectRef = "issujcvninltzvxdfhqd"
)

if (-not $token) {
    $token = Read-Host "Informe o Supabase Access Token (sbp_...)"
}

$apiUrl = "https://api.supabase.com/v1/projects/$projectRef/database/query"

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

$sqlContent = [System.IO.File]::ReadAllText("$PSScriptRoot\supabase_schema.sql", [System.Text.Encoding]::UTF8)

Write-Host "Deploying complete Supabase Schema from supabase_schema.sql..."
$body = @{ query = $sqlContent } | ConvertTo-Json
$res = Invoke-RestMethod -Uri $apiUrl -Method Post -Headers $headers -Body $body
Write-Host "Schema deployed successfully!"
