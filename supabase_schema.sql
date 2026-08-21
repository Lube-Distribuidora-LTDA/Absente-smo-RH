-- =========================================================================
-- SCHEMA SUPABASE COMPLETO & OTIMIZADO: BI DE ABSENTEÍSMO RH (LUBE DISTRIBUIDORA)
-- PROJETO: issujcvninltzvxdfhqd (ABSENTEISMO RH)
-- =========================================================================

-- ==========================================================
-- 1. TABELAS PRINCIPAIS DO SISTEMA
-- ==========================================================

-- 1.1 Ocorrências de Absenteísmo (Fato Principal)
CREATE TABLE IF NOT EXISTS public.ocorrencias_absenteismo (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    funcionario TEXT NOT NULL,
    empresa TEXT DEFAULT 'LUBE DISTRIBUIDORA LTDA',
    data_iso DATE NOT NULL,
    data_formatada TEXT,
    ano INTEGER NOT NULL,
    mes INTEGER NOT NULL,
    mes_nome TEXT,
    mes_ano TEXT,
    ano_mes_sort TEXT,
    dia_semana TEXT,
    dia_semana_num INTEGER,
    dia INTEGER,
    motivo TEXT NOT NULL,
    categoria TEXT NOT NULL,
    tipo_absenteismo TEXT NOT NULL,
    setor TEXT NOT NULL,
    funcao TEXT NOT NULL,
    dt_admissao_iso DATE,
    dt_admissao_formatada TEXT,
    tempo_casa_anos NUMERIC(5, 2),
    observacao TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.2 Dimensão Colaboradores
CREATE TABLE IF NOT EXISTS public.colaboradores (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome TEXT UNIQUE NOT NULL,
    empresa TEXT DEFAULT 'LUBE DISTRIBUIDORA LTDA',
    setor TEXT,
    funcao TEXT,
    dt_admissao DATE,
    dt_admissao_formatada TEXT,
    tempo_casa_anos NUMERIC(5, 2),
    status TEXT DEFAULT 'ATIVO',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.3 Dimensão Setores
CREATE TABLE IF NOT EXISTS public.setores (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome TEXT UNIQUE NOT NULL,
    descricao TEXT,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.4 Dimensão Cargos / Funções
CREATE TABLE IF NOT EXISTS public.cargos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome TEXT UNIQUE NOT NULL,
    setor_padrao TEXT,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.5 Dimensão Motivos e Classificações de Ausência
CREATE TABLE IF NOT EXISTS public.motivos_ausencia (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    motivo TEXT UNIQUE NOT NULL,
    categoria TEXT NOT NULL,
    tipo_absenteismo TEXT NOT NULL,
    descricao TEXT,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.6 Histórico e Auditoria de Importações (Excel/CSV/REST)
CREATE TABLE IF NOT EXISTS public.historico_importacoes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome_arquivo TEXT NOT NULL,
    total_registros INTEGER NOT NULL DEFAULT 0,
    aba_origem TEXT,
    status TEXT DEFAULT 'CONCLUIDO',
    usuario TEXT DEFAULT 'RH Lube',
    detalhes JSONB,
    data_importacao TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================================
-- 2. ÍNDICES DE ALTA PERFORMANCE (B-TREE & COMPÓSITOS)
-- ==========================================================
CREATE INDEX IF NOT EXISTS idx_absenteismo_data_iso ON public.ocorrencias_absenteismo(data_iso);
CREATE INDEX IF NOT EXISTS idx_absenteismo_funcionario ON public.ocorrencias_absenteismo(funcionario);
CREATE INDEX IF NOT EXISTS idx_absenteismo_setor ON public.ocorrencias_absenteismo(setor);
CREATE INDEX IF NOT EXISTS idx_absenteismo_funcao ON public.ocorrencias_absenteismo(funcao);
CREATE INDEX IF NOT EXISTS idx_absenteismo_tipo ON public.ocorrencias_absenteismo(tipo_absenteismo);
CREATE INDEX IF NOT EXISTS idx_absenteismo_categoria ON public.ocorrencias_absenteismo(categoria);
CREATE INDEX IF NOT EXISTS idx_absenteismo_ano_mes ON public.ocorrencias_absenteismo(ano_mes_sort);
CREATE INDEX IF NOT EXISTS idx_absenteismo_dia_semana ON public.ocorrencias_absenteismo(dia_semana);
CREATE INDEX IF NOT EXISTS idx_absenteismo_comp_filtro ON public.ocorrencias_absenteismo(setor, tipo_absenteismo, data_iso);

-- ==========================================================
-- 3. FUNÇÕES E TRIGGERS AUTOMÁTICOS
-- ==========================================================

-- 3.1 Trigger para atualização do timestamp updated_at
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ocorrencias_updated_at ON public.ocorrencias_absenteismo;
CREATE TRIGGER trg_ocorrencias_updated_at
BEFORE UPDATE ON public.ocorrencias_absenteismo
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_colaboradores_updated_at ON public.colaboradores;
CREATE TRIGGER trg_colaboradores_updated_at
BEFORE UPDATE ON public.colaboradores
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- 3.2 Trigger para preenchimento inteligente de datas e calendários
CREATE OR REPLACE FUNCTION public.fn_enrich_ocorrencia()
RETURNS TRIGGER AS $$
DECLARE
    v_dia_semana_pt TEXT[] := ARRAY['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    v_mes_pt TEXT[] := ARRAY['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    v_dow INT;
    v_m INT;
    v_y INT;
    v_d INT;
BEGIN
    IF NEW.data_iso IS NOT NULL THEN
        v_y := EXTRACT(YEAR FROM NEW.data_iso)::INT;
        v_m := EXTRACT(MONTH FROM NEW.data_iso)::INT;
        v_d := EXTRACT(DAY FROM NEW.data_iso)::INT;
        v_dow := EXTRACT(DOW FROM NEW.data_iso)::INT; -- 0=Domingo, 1=Segunda, etc.

        NEW.ano := v_y;
        NEW.mes := v_m;
        NEW.dia := v_d;
        NEW.dia_semana_num := v_dow;
        NEW.dia_semana := v_dia_semana_pt[v_dow + 1];
        NEW.mes_nome := v_mes_pt[v_m];
        NEW.mes_ano := v_mes_pt[v_m] || '/' || v_y;
        NEW.ano_mes_sort := v_y || '-' || LPAD(v_m::TEXT, 2, '0');
        
        IF NEW.data_formatada IS NULL OR NEW.data_formatada = '' THEN
            NEW.data_formatada := LPAD(v_d::TEXT, 2, '0') || '/' || LPAD(v_m::TEXT, 2, '0') || '/' || v_y;
        END IF;

        IF NEW.dt_admissao_iso IS NOT NULL THEN
            IF NEW.dt_admissao_formatada IS NULL OR NEW.dt_admissao_formatada = '' THEN
                NEW.dt_admissao_formatada := TO_CHAR(NEW.dt_admissao_iso, 'DD/MM/YYYY');
            END IF;
            IF NEW.tempo_casa_anos IS NULL THEN
                NEW.tempo_casa_anos := ROUND((NEW.data_iso - NEW.dt_admissao_iso)::NUMERIC / 365.25, 2);
                IF NEW.tempo_casa_anos < 0 THEN NEW.tempo_casa_anos := 0; END IF;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enrich_ocorrencia ON public.ocorrencias_absenteismo;
CREATE TRIGGER trg_enrich_ocorrencia
BEFORE INSERT OR UPDATE ON public.ocorrencias_absenteismo
FOR EACH ROW EXECUTE FUNCTION public.fn_enrich_ocorrencia();

-- ==========================================================
-- 4. VIEWS ANALÍTICAS PARA BI E DASHBOARDS
-- ==========================================================

-- 4.1 View de KPIs Gerais
CREATE OR REPLACE VIEW public.vw_kpis_absenteismo AS
SELECT 
    COUNT(*)::INTEGER AS total_ocorrencias,
    COUNT(DISTINCT funcionario)::INTEGER AS colaboradores_impactados,
    COUNT(*) FILTER (WHERE tipo_absenteismo = 'Injustificado' OR motivo ILIKE 'falta%' OR motivo ILIKE 'suspens%')::INTEGER AS faltas_injustificadas,
    COUNT(*) FILTER (WHERE tipo_absenteismo = 'Justificado')::INTEGER AS atestados_justificados,
    COUNT(*) FILTER (WHERE tipo_absenteismo = 'Compensacao/Folga')::INTEGER AS folgas_banco_horas,
    COUNT(*) FILTER (WHERE tipo_absenteismo = 'Desenvolvimento')::INTEGER AS treinamentos_capacitacao,
    ROUND(COUNT(*)::NUMERIC / NULLIF(COUNT(DISTINCT funcionario), 0), 2) AS media_por_colaborador
FROM public.ocorrencias_absenteismo;

-- 4.2 View de Resumo por Setor
CREATE OR REPLACE VIEW public.vw_resumo_setor AS
SELECT 
    setor,
    COUNT(*)::INTEGER AS total,
    COUNT(*) FILTER (WHERE tipo_absenteismo = 'Injustificado' OR motivo ILIKE 'falta%')::INTEGER AS injustificadas,
    COUNT(*) FILTER (WHERE tipo_absenteismo = 'Justificado')::INTEGER AS justificadas,
    COUNT(DISTINCT funcionario)::INTEGER AS colaboradores_unicos,
    ROUND((COUNT(*)::NUMERIC / (SELECT NULLIF(COUNT(*), 0) FROM public.ocorrencias_absenteismo)) * 100, 2) AS perc_total
FROM public.ocorrencias_absenteismo
GROUP BY setor
ORDER BY total DESC;

-- 4.3 View de Resumo por Motivo
CREATE OR REPLACE VIEW public.vw_resumo_motivo AS
SELECT 
    motivo,
    categoria,
    tipo_absenteismo,
    COUNT(*)::INTEGER AS total,
    COUNT(DISTINCT funcionario)::INTEGER AS colaboradores_afetados
FROM public.ocorrencias_absenteismo
GROUP BY motivo, categoria, tipo_absenteismo
ORDER BY total DESC;

-- 4.4 View de Resumo por Dia da Semana
CREATE OR REPLACE VIEW public.vw_resumo_dia_semana AS
SELECT 
    dia_semana,
    dia_semana_num,
    COUNT(*)::INTEGER AS total,
    COUNT(*) FILTER (WHERE tipo_absenteismo = 'Injustificado' OR motivo ILIKE 'falta%')::INTEGER AS injustificadas,
    ROUND((COUNT(*)::NUMERIC / (SELECT NULLIF(COUNT(*), 0) FROM public.ocorrencias_absenteismo)) * 100, 2) AS perc_total
FROM public.ocorrencias_absenteismo
GROUP BY dia_semana, dia_semana_num
ORDER BY dia_semana_num ASC;

-- 4.5 View de Ranking de Faltas Injustificadas
CREATE OR REPLACE VIEW public.vw_ranking_injustificadas AS
SELECT 
    funcionario,
    setor,
    funcao,
    COUNT(*)::INTEGER AS total_faltas_injustificadas,
    MIN(data_iso) AS primeira_ocorrencia,
    MAX(data_iso) AS ultima_ocorrencia
FROM public.ocorrencias_absenteismo
WHERE tipo_absenteismo = 'Injustificado' OR motivo ILIKE 'falta%'
GROUP BY funcionario, setor, funcao
ORDER BY total_faltas_injustificadas DESC;

-- 4.6 View de Evolução Mensal por Tipo
CREATE OR REPLACE VIEW public.vw_evolucao_mensal AS
SELECT 
    ano_mes_sort,
    mes_ano,
    ano,
    mes,
    COUNT(*)::INTEGER AS total_mes,
    COUNT(*) FILTER (WHERE tipo_absenteismo = 'Injustificado' OR motivo ILIKE 'falta%')::INTEGER AS injustificadas,
    COUNT(*) FILTER (WHERE tipo_absenteismo = 'Justificado')::INTEGER AS justificadas,
    COUNT(*) FILTER (WHERE tipo_absenteismo = 'Compensacao/Folga')::INTEGER AS compensacao_folga,
    COUNT(*) FILTER (WHERE tipo_absenteismo = 'Desenvolvimento')::INTEGER AS desenvolvimento,
    COUNT(DISTINCT funcionario)::INTEGER AS colaboradores_ativos_mes
FROM public.ocorrencias_absenteismo
GROUP BY ano_mes_sort, mes_ano, ano, mes
ORDER BY ano_mes_sort ASC;

-- ==========================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES & PERMISSIONS
-- ==========================================================
ALTER TABLE public.ocorrencias_absenteismo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colaboradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motivos_ausencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_importacoes ENABLE ROW LEVEL SECURITY;

-- Políticas de Acesso Total para anon e authenticated (Dashboard RH)
DROP POLICY IF EXISTS "Anon e Auth podem ler ocorrencias" ON public.ocorrencias_absenteismo;
CREATE POLICY "Anon e Auth podem ler ocorrencias" ON public.ocorrencias_absenteismo FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anon e Auth podem inserir ocorrencias" ON public.ocorrencias_absenteismo;
CREATE POLICY "Anon e Auth podem inserir ocorrencias" ON public.ocorrencias_absenteismo FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anon e Auth podem atualizar ocorrencias" ON public.ocorrencias_absenteismo;
CREATE POLICY "Anon e Auth podem atualizar ocorrencias" ON public.ocorrencias_absenteismo FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Anon e Auth podem deletar ocorrencias" ON public.ocorrencias_absenteismo;
CREATE POLICY "Anon e Auth podem deletar ocorrencias" ON public.ocorrencias_absenteismo FOR DELETE USING (true);

DROP POLICY IF EXISTS "Anon e Auth colaboradores all" ON public.colaboradores;
CREATE POLICY "Anon e Auth colaboradores all" ON public.colaboradores FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon e Auth setores all" ON public.setores;
CREATE POLICY "Anon e Auth setores all" ON public.setores FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon e Auth cargos all" ON public.cargos;
CREATE POLICY "Anon e Auth cargos all" ON public.cargos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon e Auth motivos all" ON public.motivos_ausencia;
CREATE POLICY "Anon e Auth motivos all" ON public.motivos_ausencia FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon e Auth importacoes all" ON public.historico_importacoes;
CREATE POLICY "Anon e Auth importacoes all" ON public.historico_importacoes FOR ALL USING (true) WITH CHECK (true);

-- Conceder permissões explícitas de GRANT
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- ==========================================================
-- 6. SUPABASE REALTIME REPLICATION
-- ==========================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'ocorrencias_absenteismo'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.ocorrencias_absenteismo;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'colaboradores'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.colaboradores;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'historico_importacoes'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.historico_importacoes;
    END IF;
END $$;
