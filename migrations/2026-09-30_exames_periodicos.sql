-- ============================================================================
-- Exames Periódicos (ASO) — tabela do controle de saúde ocupacional
-- ============================================================================
-- Alimenta a aba "Exames Periódicos" do painel. A origem é a planilha
-- "Controle periodicos.xls", aba "Controle", importada pela própria tela.
--
-- O que NÃO fica aqui: a situação (vencido / a vencer / em dia). Ela é calculada
-- no painel a cada carga, a partir de proximo_aso_iso contra a data de hoje.
-- Gravar a situação congelaria um retrato que envelhece sozinho — foi exatamente
-- o problema da coluna STATUS da planilha.
--
-- Como aplicar: cole no SQL Editor do Supabase e execute.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.exames_periodicos (
    id                  BIGSERIAL PRIMARY KEY,
    empresa             TEXT NOT NULL DEFAULT '',
    funcionario         TEXT NOT NULL,
    funcao              TEXT,
    departamento        TEXT,
    admissao_iso        DATE,
    ultimo_exame_iso    DATE,
    tipo                TEXT,
    periodicidade_meses INT  NOT NULL DEFAULT 12,
    proximo_aso_iso     DATE,
    -- Guarda o STATUS cru da planilha. Serve só para os casos que a data não
    -- conta sozinha, como "desligada"; a validade em si é recalculada no painel.
    situacao_planilha   TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Um colaborador aparece uma vez por empresa: é a chave que o upsert da
-- importação usa para atualizar em vez de duplicar a cada planilha nova.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exames_periodicos_chave
    ON public.exames_periodicos (empresa, funcionario);

CREATE INDEX IF NOT EXISTS idx_exames_periodicos_proximo
    ON public.exames_periodicos (proximo_aso_iso);

CREATE INDEX IF NOT EXISTS idx_exames_periodicos_depto
    ON public.exames_periodicos (departamento);

DROP TRIGGER IF EXISTS trg_exames_periodicos_updated_at ON public.exames_periodicos;
CREATE TRIGGER trg_exames_periodicos_updated_at
BEFORE UPDATE ON public.exames_periodicos
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Mesmo padrão das demais tabelas do projeto: RLS ligado, e o painel lê com a
-- chave anon. Se o acesso for restringido depois, é aqui que a política muda.
ALTER TABLE public.exames_periodicos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exames_periodicos_select" ON public.exames_periodicos;
CREATE POLICY "exames_periodicos_select" ON public.exames_periodicos
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "exames_periodicos_write" ON public.exames_periodicos;
CREATE POLICY "exames_periodicos_write" ON public.exames_periodicos
    FOR ALL USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================================
-- Conferência (rode depois de importar a planilha pela tela)
-- ============================================================================
-- SELECT COUNT(*) AS total,
--        COUNT(*) FILTER (WHERE proximo_aso_iso < CURRENT_DATE)                              AS vencidos,
--        COUNT(*) FILTER (WHERE proximo_aso_iso BETWEEN CURRENT_DATE AND CURRENT_DATE + 90)  AS vencem_90d,
--        COUNT(*) FILTER (WHERE proximo_aso_iso IS NULL)                                     AS sem_registro
-- FROM public.exames_periodicos;
