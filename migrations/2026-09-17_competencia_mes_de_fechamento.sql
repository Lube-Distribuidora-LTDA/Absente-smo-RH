-- ============================================================================
-- Competência do ponto: passa a levar o nome do mês em que o período FECHA
-- ============================================================================
-- 21/12 a 20/01 = Janeiro, 21/01 a 20/02 = Fevereiro.
--
-- Antes, a trigger fn_enrich_ocorrencia gravava ano/mes/mes_nome/mes_ano/
-- ano_mes_sort a partir do MÊS DE CALENDÁRIO da data da ausência. O painel já
-- recalcula a competência a cada carga (computeCompetencia() no index.html),
-- então a tela sempre esteve certa — mas as colunas gravadas e as views
-- vw_evolucao_mensal / vw_kpis_absenteismo ficavam discordando do painel.
-- Esta migração alinha o banco com o painel.
--
-- NÃO altera data_iso (fonte da verdade), nem dia, dia_semana, dia_semana_num
-- ou data_formatada, que continuam representando a data REAL da ausência —
-- o gráfico de padrão semanal depende disso.
--
-- O dia de corte (21) é parametrizável na interface. Se ele for alterado lá,
-- ajuste o DEFAULT de fn_competencia_ponto e rode de novo o passo 3 (backfill).
--
-- Como aplicar: cole no SQL Editor do Supabase e execute.
-- ============================================================================

BEGIN;

-- 1. Função de competência ------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_competencia_ponto(p_data DATE, p_dia_corte INT DEFAULT 21)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT date_trunc('month',
        CASE WHEN EXTRACT(DAY FROM p_data)::INT >= p_dia_corte
             THEN p_data + INTERVAL '1 month'
             ELSE p_data::TIMESTAMP
        END
    )::DATE;
$$;

COMMENT ON FUNCTION public.fn_competencia_ponto(DATE, INT) IS
'Primeiro dia do mês de competência do ponto para uma data. O dia de corte padrão (21) espelha o parâmetro "Corte do Ponto" do painel; se ele mudar na interface, atualize aqui e rode o backfill de ocorrencias_absenteismo.';

-- 2. Trigger de enriquecimento --------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_enrich_ocorrencia()
RETURNS TRIGGER AS $$
DECLARE
    v_dia_semana_pt TEXT[] := ARRAY['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    v_mes_pt TEXT[] := ARRAY['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    v_dow INT;
    v_d INT;
    v_comp DATE;
    v_comp_m INT;
    v_comp_y INT;
BEGIN
    IF NEW.data_iso IS NOT NULL THEN
        v_d := EXTRACT(DAY FROM NEW.data_iso)::INT;
        v_dow := EXTRACT(DOW FROM NEW.data_iso)::INT; -- 0=Domingo, 1=Segunda, etc.

        v_comp := public.fn_competencia_ponto(NEW.data_iso);
        v_comp_y := EXTRACT(YEAR FROM v_comp)::INT;
        v_comp_m := EXTRACT(MONTH FROM v_comp)::INT;

        NEW.ano := v_comp_y;
        NEW.mes := v_comp_m;
        NEW.mes_nome := v_mes_pt[v_comp_m];
        NEW.mes_ano := v_mes_pt[v_comp_m] || '/' || v_comp_y;
        NEW.ano_mes_sort := v_comp_y || '-' || LPAD(v_comp_m::TEXT, 2, '0');

        NEW.dia := v_d;
        NEW.dia_semana_num := v_dow;
        NEW.dia_semana := v_dia_semana_pt[v_dow + 1];

        IF NEW.data_formatada IS NULL OR NEW.data_formatada = '' THEN
            NEW.data_formatada := TO_CHAR(NEW.data_iso, 'DD/MM/YYYY');
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

-- 3. Backfill das ocorrências já gravadas ---------------------------------
-- Em 17/09/2026 eram 333 de 1.189 linhas divergentes (os dias 21 ao fim do mês).
-- A tabela está no Realtime: cada linha atualizada vira um evento UPDATE para
-- quem estiver com o painel aberto. Rode fora do horário de uso, ou avise para
-- recarregar a página depois.
UPDATE public.ocorrencias_absenteismo
SET data_iso = data_iso   -- só para disparar a trigger, que recalcula as colunas
WHERE ano_mes_sort IS DISTINCT FROM
      to_char(public.fn_competencia_ponto(data_iso), 'YYYY-MM');

COMMIT;

-- 4. Conferência (rode depois; deve voltar divergentes = 0) ----------------
-- SELECT COUNT(*) AS total,
--        COUNT(*) FILTER (
--          WHERE ano_mes_sort IS DISTINCT FROM to_char(public.fn_competencia_ponto(data_iso), 'YYYY-MM')
--        ) AS divergentes
-- FROM public.ocorrencias_absenteismo;

-- SELECT ano_mes_sort, mes_ano, MIN(data_iso) AS primeiro_dia, MAX(data_iso) AS ultimo_dia, COUNT(*)
-- FROM public.ocorrencias_absenteismo
-- GROUP BY ano_mes_sort, mes_ano
-- ORDER BY ano_mes_sort;
