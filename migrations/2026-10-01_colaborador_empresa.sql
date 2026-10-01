-- ============================================================================
-- Empresa por colaborador (Absenteísmo)
-- ============================================================================
-- JÁ APLICADA no projeto jhznrwmwszpfogvbjnjx em 2026-10-01.
-- Fica versionada aqui para o schema do repositório refletir o banco.
--
-- A planilha de absenteísmo NÃO traz a empresa — o importador grava um valor
-- padrão em todas as linhas. O painel resolve a empresa pelo NOME do colaborador,
-- cruzando com o cadastro de empregados e com o controle de exames periódicos.
-- Quem não aparece em nenhum dos dois é atribuído à mão nesta tabela, pela própria
-- tela, e passa a valer para toda importação futura.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.colaborador_empresa (
    id                BIGSERIAL PRIMARY KEY,
    funcionario_chave TEXT NOT NULL,
    funcionario_nome  TEXT NOT NULL,
    empresa           TEXT NOT NULL,
    origem            TEXT NOT NULL DEFAULT 'MANUAL',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A chave é o nome normalizado (maiúsculas, sem acento, só letras/números e
-- espaço) — é assim que o painel cruza as bases. Garante uma empresa por pessoa
-- e é o onConflict do upsert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_colaborador_empresa_chave
    ON public.colaborador_empresa (funcionario_chave);

DROP TRIGGER IF EXISTS trg_colaborador_empresa_updated_at ON public.colaborador_empresa;
CREATE TRIGGER trg_colaborador_empresa_updated_at
BEFORE UPDATE ON public.colaborador_empresa
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

ALTER TABLE public.colaborador_empresa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "colaborador_empresa_select" ON public.colaborador_empresa;
CREATE POLICY "colaborador_empresa_select" ON public.colaborador_empresa
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "colaborador_empresa_write" ON public.colaborador_empresa;
CREATE POLICY "colaborador_empresa_write" ON public.colaborador_empresa
    FOR ALL USING (true) WITH CHECK (true);

-- Conferência: quem ainda está sem empresa definida à mão
-- SELECT * FROM public.colaborador_empresa ORDER BY funcionario_nome;
