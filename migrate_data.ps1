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

function Escape-Sql([string]$val) {
    if ($null -eq $val -or $val -eq "") { return "NULL" }
    $escaped = $val.Replace("'", "''")
    return "'$escaped'"
}

Write-Host "Reading dataset from dashboard_dataset.json..."
$rawJson = [System.IO.File]::ReadAllText("$PSScriptRoot\dashboard_dataset.json", [System.Text.Encoding]::UTF8)
$data = $rawJson | ConvertFrom-Json
$total = $data.Count
Write-Host "Total records loaded: $total"

# 1. Truncate / clean before initial load
$cleanSql = "TRUNCATE TABLE public.ocorrencias_absenteismo, public.colaboradores, public.setores, public.cargos, public.motivos_ausencia, public.historico_importacoes RESTART IDENTITY CASCADE;"
$body = @{ query = $cleanSql } | ConvertTo-Json
Invoke-RestMethod -Uri $apiUrl -Method Post -Headers $headers -Body $body | Out-Null
Write-Host "Tables truncated."

# 2. Extract Setores, Cargos, Motivos, Colaboradores
$setoresSet = [System.Collections.Generic.HashSet[string]]::new()
$cargosSet = [System.Collections.Generic.HashSet[string]]::new()
$motivosMap = [System.Collections.Generic.Dictionary[string, Object]]::new()
$colabMap = [System.Collections.Generic.Dictionary[string, Object]]::new()

foreach ($r in $data) {
    if ($r.setor) { [void]$setoresSet.Add($r.setor.Trim()) }
    if ($r.funcao) { [void]$cargosSet.Add($r.funcao.Trim()) }
    
    $mText = if ($r.motivo) { $r.motivo.Trim() } else { "Outros" }
    $cText = if ($r.categoria) { $r.categoria.Trim() } else { "Outros" }
    $tText = if ($r.tipo_absenteismo) { $r.tipo_absenteismo.Trim() } else { "Outros" }
    if (-not $motivosMap.ContainsKey($mText)) {
        $motivosMap[$mText] = @{
            motivo = $mText
            categoria = $cText
            tipo = $tText
        }
    }

    $fName = if ($r.funcionario) { $r.funcionario.Trim() } else { "COLABORADOR" }
    if (-not $colabMap.ContainsKey($fName)) {
        $colabMap[$fName] = @{
            nome = $fName
            empresa = if ($r.empresa) { $r.empresa.Trim() } else { "LUBE DISTRIBUIDORA LTDA" }
            setor = if ($r.setor) { $r.setor.Trim() } else { "" }
            funcao = if ($r.funcao) { $r.funcao.Trim() } else { "" }
            dt_adm = $r.dt_admissao_iso
            dt_adm_fmt = $r.dt_admissao_formatada
            tempo_casa = $r.tempo_casa_anos
        }
    }
}

# Insert Setores
$setoresList = ($setoresSet | ForEach-Object { "(" + (Escape-Sql $_) + ")" }) -join ", "
$setoresSql = "INSERT INTO public.setores (nome) VALUES $setoresList ON CONFLICT (nome) DO NOTHING;"
$body = @{ query = $setoresSql } | ConvertTo-Json
Invoke-RestMethod -Uri $apiUrl -Method Post -Headers $headers -Body $body | Out-Null
Write-Host "Setores inserted: $($setoresSet.Count)"

# Insert Cargos
$cargosList = ($cargosSet | ForEach-Object { "(" + (Escape-Sql $_) + ")" }) -join ", "
$cargosSql = "INSERT INTO public.cargos (nome) VALUES $cargosList ON CONFLICT (nome) DO NOTHING;"
$body = @{ query = $cargosSql } | ConvertTo-Json
Invoke-RestMethod -Uri $apiUrl -Method Post -Headers $headers -Body $body | Out-Null
Write-Host "Cargos inserted: $($cargosSet.Count)"

# Insert Motivos
$motivoRows = foreach ($m in $motivosMap.Values) {
    "({0}, {1}, {2})" -f (Escape-Sql $m.motivo), (Escape-Sql $m.categoria), (Escape-Sql $m.tipo)
}
$motivoSql = "INSERT INTO public.motivos_ausencia (motivo, categoria, tipo_absenteismo) VALUES " + ($motivoRows -join ", ") + " ON CONFLICT (motivo) DO NOTHING;"
$body = @{ query = $motivoSql } | ConvertTo-Json
Invoke-RestMethod -Uri $apiUrl -Method Post -Headers $headers -Body $body | Out-Null
Write-Host "Motivos de Ausencia inserted: $($motivoRows.Count)"

# Insert Colaboradores
$colabRows = foreach ($c in $colabMap.Values) {
    $dtAdmVal = if ($c.dt_adm) { Escape-Sql $c.dt_adm } else { "NULL" }
    $dtAdmFmtVal = if ($c.dt_adm_fmt) { Escape-Sql $c.dt_adm_fmt } else { "NULL" }
    $tempoVal = if ($null -ne $c.tempo_casa -and "$($c.tempo_casa)" -ne "") { "$($c.tempo_casa)".Replace(",", ".") } else { "NULL" }
    "({0}, {1}, {2}, {3}, {4}, {5}, {6})" -f `
        (Escape-Sql $c.nome), (Escape-Sql $c.empresa), (Escape-Sql $c.setor), (Escape-Sql $c.funcao), $dtAdmVal, $dtAdmFmtVal, $tempoVal
}
$colabSql = "INSERT INTO public.colaboradores (nome, empresa, setor, funcao, dt_admissao, dt_admissao_formatada, tempo_casa_anos) VALUES " + ($colabRows -join ", ") + " ON CONFLICT (nome) DO NOTHING;"
$body = @{ query = $colabSql } | ConvertTo-Json
Invoke-RestMethod -Uri $apiUrl -Method Post -Headers $headers -Body $body | Out-Null
Write-Host "Colaboradores inserted: $($colabRows.Count)"

# 3. Batch Insert Ocorrencias Absenteismo (in chunks of 250 records)
$chunkSize = 250
$insertedTotal = 0

for ($i = 0; $i -lt $total; $i += $chunkSize) {
    $endIdx = [Math]::Min($i + $chunkSize - 1, $total - 1)
    $chunk = $data[$i..$endIdx]
    
    $valRows = foreach ($r in $chunk) {
        $empresaStr = if ($r.empresa) { $r.empresa } else { "LUBE DISTRIBUIDORA LTDA" }
        $dtAdmIsoVal = if ($r.dt_admissao_iso) { Escape-Sql $r.dt_admissao_iso } else { "NULL" }
        $dtAdmFmtVal = if ($r.dt_admissao_formatada) { Escape-Sql $r.dt_admissao_formatada } else { "NULL" }
        $tempoVal = if ($null -ne $r.tempo_casa_anos -and "$($r.tempo_casa_anos)" -ne "") { "$($r.tempo_casa_anos)".Replace(",", ".") } else { "NULL" }
        $diaVal = if ($r.dia) { [int]$r.dia } else { "NULL" }
        $diaNumVal = if ($null -ne $r.dia_semana_num) { [int]$r.dia_semana_num } else { "NULL" }
        $anoVal = if ($r.ano) { [int]$r.ano } else { 2026 }
        $mesVal = if ($r.mes) { [int]$r.mes } else { 1 }

        "({0}, {1}, {2}, {3}, {4}, {5}, {6}, {7}, {8}, {9}, {10}, {11}, {12}, {13}, {14}, {15}, {16}, {17}, {18}, {19})" -f `
            (Escape-Sql $r.funcionario), `
            (Escape-Sql $empresaStr), `
            (Escape-Sql $r.data_iso), `
            (Escape-Sql $r.data_formatada), `
            $anoVal, `
            $mesVal, `
            (Escape-Sql $r.mes_nome), `
            (Escape-Sql $r.mes_ano), `
            (Escape-Sql $r.ano_mes_sort), `
            (Escape-Sql $r.dia_semana), `
            $diaNumVal, `
            $diaVal, `
            (Escape-Sql $r.motivo), `
            (Escape-Sql $r.categoria), `
            (Escape-Sql $r.tipo_absenteismo), `
            (Escape-Sql $r.setor), `
            (Escape-Sql $r.funcao), `
            $dtAdmIsoVal, `
            $dtAdmFmtVal, `
            $tempoVal
    }

    $insertChunkSql = "INSERT INTO public.ocorrencias_absenteismo (funcionario, empresa, data_iso, data_formatada, ano, mes, mes_nome, mes_ano, ano_mes_sort, dia_semana, dia_semana_num, dia, motivo, categoria, tipo_absenteismo, setor, funcao, dt_admissao_iso, dt_admissao_formatada, tempo_casa_anos) VALUES " + ($valRows -join ", ") + ";"

    $body = @{ query = $insertChunkSql } | ConvertTo-Json
    Invoke-RestMethod -Uri $apiUrl -Method Post -Headers $headers -Body $body | Out-Null
    $insertedTotal += $chunk.Count
    Write-Host "Progress: $insertedTotal / $total occurrences inserted..."
}

# 4. Insert Initial Import History
$histSql = "INSERT INTO public.historico_importacoes (nome_arquivo, total_registros, aba_origem, status, usuario, detalhes) VALUES ('Base_Historica_Absenteismo_Lube.xlsx', $total, 'POWERBI', 'CONCLUIDO', 'Sistema RH', '{`"origem`": `"Carga Inicial Automatica`"}');"
$body = @{ query = $histSql } | ConvertTo-Json
Invoke-RestMethod -Uri $apiUrl -Method Post -Headers $headers -Body $body | Out-Null
Write-Host "Import history logged."

Write-Host "DATA MIGRATION COMPLETED SUCCESSFULLY!"
