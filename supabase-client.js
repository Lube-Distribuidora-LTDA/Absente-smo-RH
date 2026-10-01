/**
 * =========================================================================
 * SUPABASE CLIENT & DATA LAYER - BI DE ABSENTEÍSMO RH (LUBE DISTRIBUIDORA)
 * =========================================================================
 * Integração 100% dinâmica com banco de dados PostgreSQL do Supabase.
 * Suporta leitura em alta velocidade, inserções manuais, importação em lote,
 * auditoria e sincronização em tempo real (PostgreSQL Realtime).
 */

// Config carregada em runtime a partir de supabase-config.js (gerado no build por generate-config.js
// a partir das variaveis de ambiente SUPABASE_URL / SUPABASE_ANON_KEY). Nunca commitar credenciais aqui.
if (!window.__SUPABASE_CONFIG__) {
    console.error('[SupabaseClient] supabase-config.js nao encontrado ou nao carregado antes deste script. Rode "npm run build" (local) ou configure as variaveis de ambiente no Vercel.');
}

const SUPABASE_CONFIG = window.__SUPABASE_CONFIG__ || {
    url: '',
    anonKey: '',
    projectName: 'RH Absenteísmo',
    projectRef: ''
};

// Global Supabase Client Instance
let _supabase = null;
let _realtimeSubscription = null;

/**
 * Inicializa e retorna o cliente Supabase oficial
 */
function getSupabaseClient() {
    if (!_supabase) {
        // The Supabase UMD bundle exposes window.supabase as a namespace object.
        // createClient lives at window.supabase.createClient (v2 UMD)
        let createClientFn = null;

        if (window.supabase && typeof window.supabase.createClient === 'function') {
            // Standard UMD bundle: window.supabase.createClient
            createClientFn = window.supabase.createClient;
        } else if (typeof createClient === 'function') {
            // Sometimes available as a global directly
            createClientFn = createClient;
        } else {
            console.error('[SupabaseClient] SDK não encontrado. Verifique se o script CDN foi carregado.');
            return null;
        }

        try {
            _supabase = createClientFn(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true
                },
                realtime: {
                    params: {
                        eventsPerSecond: 10
                    }
                }
            });
            console.log('[SupabaseClient] Cliente inicializado com sucesso:', SUPABASE_CONFIG.projectRef);
        } catch (initErr) {
            console.error('[SupabaseClient] Falha ao criar o cliente:', initErr);
            return null;
        }
    }
    return _supabase;
}

/**
 * Testa a conectividade com o banco de dados e calcula a latência
 */
async function testDatabaseConnection() {
    const client = getSupabaseClient();
    if (!client) return { connected: false, error: 'SDK do Supabase não carregado', latencyMs: 0 };

    const startTime = performance.now();
    try {
        const { data, error, count } = await client
            .from('ocorrencias_absenteismo')
            .select('id', { count: 'exact', head: true });

        const latencyMs = Math.round(performance.now() - startTime);

        if (error) {
            console.error('Erro de conexão Supabase:', error);
            return { connected: false, error: error.message, latencyMs };
        }

        return {
            connected: true,
            totalRegistros: count || 0,
            latencyMs,
            projectName: SUPABASE_CONFIG.projectName
        };
    } catch (err) {
        return {
            connected: false,
            error: err.message || 'Falha de rede ao conectar ao Supabase',
            latencyMs: Math.round(performance.now() - startTime)
        };
    }
}

/**
 * Busca o ID da importação mais recente registrada no histórico
 */
async function fetchLatestImportIdDB() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('historico_importacoes')
        .select('id')
        .order('data_importacao', { ascending: false })
        .limit(1);

    if (error) {
        console.error('Erro ao buscar importação mais recente:', error);
        throw error;
    }

    return data && data.length > 0 ? data[0].id : null;
}

/**
 * Busca o histórico completo de importações, mais recente primeiro
 */
async function fetchHistoricoImportacoesDB() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('historico_importacoes')
        .select('*')
        .order('data_importacao', { ascending: false });

    if (error) {
        console.error('Erro ao buscar histórico de importações:', error);
        throw error;
    }

    return data || [];
}

/**
 * Busca uma importação específica do histórico pelo ID (inclui diagnostico_ia, se já gerado)
 */
async function fetchImportacaoByIdDB(id) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');
    if (id === null || id === undefined) return null;

    const { data, error } = await client
        .from('historico_importacoes')
        .select('*')
        .eq('id', id)
        .limit(1);

    if (error) {
        console.error('Erro ao buscar importação por ID:', error);
        throw error;
    }

    return data && data.length > 0 ? data[0] : null;
}

/**
 * Salva o diagnóstico executivo gerado por IA para uma importação específica
 */
async function saveDiagnosticoIADB(importId, cards) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('historico_importacoes')
        .update({ diagnostico_ia: cards, diagnostico_ia_gerado_em: new Date().toISOString() })
        .eq('id', importId)
        .select();

    if (error) {
        console.error('Erro ao salvar diagnóstico IA:', error);
        throw error;
    }

    return data && data.length > 0 ? data[0] : null;
}

/**
 * Renomeia uma importação do histórico (rótulo customizado)
 */
async function renameImportacaoDB(id, novoNome) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('historico_importacoes')
        .update({ nome_customizado: novoNome })
        .eq('id', id)
        .select();

    if (error) {
        console.error('Erro ao renomear importação:', error);
        throw error;
    }

    return data && data.length > 0 ? data[0] : null;
}

/**
 * Busca ocorrências de absenteísmo no Supabase.
 * Se importId for informado, retorna apenas os registros dessa importação.
 * Se for omitido, resolve automaticamente a importação mais recente (visão "atual" do dashboard).
 * Passe null explicitamente para buscar TODOS os registros sem filtro de importação.
 */
/**
 * Busca uma tabela inteira, em páginas de 1000 linhas (limite do PostgREST).
 *
 * A primeira página vem com a contagem total; sabendo o total, as páginas restantes
 * são buscadas EM PARALELO. Buscar uma de cada vez custava caro: o projeto fica em
 * us-west-2 e cada ida e volta do Brasil leva ~0,7s, então as 15 páginas da
 * interjornada somavam ~11s de espera em fila só para a aba abrir.
 *
 * IMPORTANTE: a ordenação precisa ser TOTAL (terminar numa coluna única). Com
 * empates, duas faixas paralelas podem repetir ou pular linhas, porque o banco
 * ordena e recorta cada requisição por conta própria.
 *
 * @param {(de:number, ate:number, comContagem:boolean) => PromiseLike<any>} montarQuery
 * @param {string} rotulo Nome amigável usado nas mensagens de erro
 */
async function fetchPaginadoDB(montarQuery, rotulo, step = 1000, maxParalelo = 12) {
    const primeira = await montarQuery(0, step - 1, true);
    if (primeira.error) {
        console.error(`Erro ao buscar ${rotulo}:`, primeira.error);
        throw primeira.error;
    }

    const registros = primeira.data || [];
    const total = primeira.count;

    // Coube tudo na primeira página, ou o banco não devolveu a contagem: nada a paginar.
    if (registros.length < step || total === null || total === undefined || total <= registros.length) {
        return registros;
    }

    const faixas = [];
    for (let de = step; de < total; de += step) {
        faixas.push([de, Math.min(de + step, total) - 1]);
    }

    // Em lotes, para não disparar dezenas de conexões de uma vez.
    const paginas = new Array(faixas.length);
    for (let i = 0; i < faixas.length; i += maxParalelo) {
        const lote = faixas.slice(i, i + maxParalelo);
        const respostas = await Promise.all(lote.map(([de, ate]) => montarQuery(de, ate, false)));
        respostas.forEach((resp, j) => {
            if (resp.error) {
                console.error(`Erro ao buscar ${rotulo} (faixa ${lote[j][0]}-${lote[j][1]}):`, resp.error);
                throw resp.error;
            }
            paginas[i + j] = resp.data || [];
        });
    }

    return registros.concat(...paginas);
}

async function fetchAbsenteismoFromDB(importId) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    let targetImportId = importId;
    if (targetImportId === undefined) {
        targetImportId = await fetchLatestImportIdDB();
    }

    // Ordem total (data_iso + id) — requisito da paginação paralela.
    return fetchPaginadoDB((de, ate, comContagem) => {
        let query = client
            .from('ocorrencias_absenteismo')
            .select('*', comContagem ? { count: 'exact' } : undefined)
            .order('data_iso', { ascending: true })
            .order('id', { ascending: true })
            .range(de, ate);

        if (targetImportId !== null && targetImportId !== undefined) {
            query = query.eq('import_id', targetImportId);
        }
        return query;
    }, 'dados de absenteísmo');
}

/**
 * Insere uma nova ocorrência de absenteísmo manualmente no Supabase
 */
async function insertOcorrenciaDB(record) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const row = { ...record };
    if (row.import_id === undefined || row.import_id === null) {
        row.import_id = await fetchLatestImportIdDB();
    }

    const { data, error } = await client
        .from('ocorrencias_absenteismo')
        .insert([row])
        .select();

    if (error) {
        console.error('Erro ao inserir ocorrência no Supabase:', error);
        throw error;
    }

    // Atualiza/insere colaborador e setor no catálogo
    try {
        if (record.funcionario) {
            await client.from('colaboradores').upsert({
                nome: record.funcionario.trim(),
                empresa: record.empresa || 'LUBE DISTRIBUIDORA LTDA',
                setor: record.setor,
                funcao: record.funcao,
                dt_admissao: record.dt_admissao_iso,
                dt_admissao_formatada: record.dt_admissao_formatada,
                tempo_casa_anos: record.tempo_casa_anos
            }, { onConflict: 'nome' });
        }
        if (record.setor) {
            await client.from('setores').upsert({ nome: record.setor.trim() }, { onConflict: 'nome' });
        }
        if (record.funcao) {
            await client.from('cargos').upsert({ nome: record.funcao.trim() }, { onConflict: 'nome' });
        }
    } catch (e) {
        console.warn('Erro secundário ao atualizar catálogo de colaboradores:', e);
    }

    return data && data.length > 0 ? data[0] : null;
}

/**
 * Chave natural de uma ocorrência de absenteísmo, usada para não duplicar o mesmo evento
 * (mesma pessoa, mesma data, mesmo motivo) quando um período já importado é reimportado.
 */
function chaveOcorrenciaAbsenteismo(r) {
    return [String(r.funcionario || '').trim().toUpperCase(), r.data_iso, String(r.motivo || '').trim().toUpperCase()].join('|');
}

/**
 * Insere múltiplos registros no Supabase em lote (ex.: importação Excel) e registra no
 * histórico de importações. As importações são CUMULATIVAS: cada nova planilha ACRESCENTA
 * as ocorrências ao que já existe (nunca substitui ou apaga meses anteriores). Registros cuja
 * combinação colaborador+data+motivo já existir são ignorados, para permitir reimportar um
 * período (ex.: para conferência) sem duplicar as mesmas faltas.
 */
async function bulkInsertOcorrenciasDB(records, fileName = 'Importacao_Planilha.xlsx', sheetName = 'BASE') {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    if (!records || records.length === 0) return { count: 0, skipped: 0 };

    // Verifica quais ocorrências do período importado já existem no banco, para não duplicá-las.
    const datas = records.map(r => r.data_iso).filter(Boolean).sort();
    const dataMin = datas[0];
    const dataMax = datas[datas.length - 1];

    const chavesExistentes = new Set();
    if (dataMin && dataMax) {
        let from = 0;
        const step = 1000;
        let keepFetching = true;
        while (keepFetching) {
            const { data, error } = await client
                .from('ocorrencias_absenteismo')
                .select('funcionario, data_iso, motivo')
                .gte('data_iso', dataMin)
                .lte('data_iso', dataMax)
                .range(from, from + step - 1);

            if (error) {
                console.error('Erro ao verificar ocorrências já existentes:', error);
                throw error;
            }
            if (data && data.length > 0) {
                data.forEach(r => chavesExistentes.add(chaveOcorrenciaAbsenteismo(r)));
                if (data.length < step) keepFetching = false;
                else from += step;
            } else {
                keepFetching = false;
            }
        }
    }

    const registrosNovos = records.filter(r => !chavesExistentes.has(chaveOcorrenciaAbsenteismo(r)));
    const skippedCount = records.length - registrosNovos.length;

    // Registra a importação no histórico ANTES de inserir os registros, para obter o import_id
    // que vai vincular cada ocorrência a esta importação específica.
    const { data: histData, error: histError } = await client
        .from('historico_importacoes')
        .insert([{
            nome_arquivo: fileName,
            total_registros: registrosNovos.length,
            aba_origem: sheetName,
            status: 'CONCLUIDO',
            usuario: 'RH Lube',
            detalhes: { data_hora: new Date().toISOString(), total_processado: records.length, novos: registrosNovos.length, ja_existentes: skippedCount }
        }])
        .select();

    if (histError) {
        console.error('Erro ao registrar histórico de importação:', histError);
        throw histError;
    }

    const importId = histData && histData.length > 0 ? histData[0].id : null;

    if (registrosNovos.length === 0) {
        return { count: 0, skipped: skippedCount, importId };
    }

    const batchSize = 250;
    let insertedCount = 0;

    // Formata campos para garantir compatibilidade com colunas do banco e vincula à importação
    const sanitized = registrosNovos.map(r => {
        const row = { ...r };
        delete row.id; // Deixa o PostgreSQL gerar o ID sequencial oficial
        row.import_id = importId;
        return row;
    });

    for (let i = 0; i < sanitized.length; i += batchSize) {
        const chunk = sanitized.slice(i, i + batchSize);
        const { data, error } = await client
            .from('ocorrencias_absenteismo')
            .insert(chunk);

        if (error) {
            console.error(`Erro ao inserir lote ${i} no Supabase:`, error);
            throw error;
        }
        insertedCount += chunk.length;
    }

    return { count: insertedCount, skipped: skippedCount, importId };
}

/**
 * Busca todos os registros mensais de turnover (entradas/saídas por setor)
 */
async function fetchTurnoverMensalDB() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('turnover_mensal')
        .select('*')
        .order('ano_mes_sort', { ascending: true })
        .order('setor', { ascending: true });

    if (error) {
        console.error('Erro ao buscar dados de turnover:', error);
        throw error;
    }
    return data || [];
}

/**
 * Insere ou atualiza (upsert) um lançamento mensal de turnover para um setor
 */
async function upsertTurnoverMensalDB(record) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('turnover_mensal')
        .upsert([record], { onConflict: 'setor,ano_mes_sort' })
        .select();

    if (error) {
        console.error('Erro ao salvar movimentação de turnover:', error);
        throw error;
    }
    return data && data.length > 0 ? data[0] : null;
}

/**
 * Busca todos os colaboradores cadastrados (Listagem de Empregados)
 */
async function fetchColaboradoresDB() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('colaboradores')
        .select('*')
        .order('nome', { ascending: true });

    if (error) {
        console.error('Erro ao buscar colaboradores:', error);
        throw error;
    }
    return data || [];
}

/**
 * Insere um novo colaborador diretamente no Supabase
 */
async function insertColaboradorDB(record) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('colaboradores')
        .insert([record])
        .select();

    if (error) {
        console.error('Erro ao inserir colaborador:', error);
        throw error;
    }
    return data && data.length > 0 ? data[0] : null;
}

/**
 * Busca a análise de necessidade de headcount por função (PAINEL HEAD)
 */
async function fetchHeadNecessidadeDB() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('head_necessidade_funcao')
        .select('*')
        .order('empresa', { ascending: true })
        .order('departamento', { ascending: true })
        .order('funcao', { ascending: true });

    if (error) {
        console.error('Erro ao buscar dados de HEAD:', error);
        throw error;
    }
    return data || [];
}

/**
 * Insere ou atualiza (upsert) um ou mais registros de necessidade de HEAD por função
 */
async function upsertHeadNecessidadeDB(records) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');
    if (!records || records.length === 0) return [];

    const { data, error } = await client
        .from('head_necessidade_funcao')
        .upsert(records, { onConflict: 'empresa,departamento,funcao' })
        .select();

    if (error) {
        console.error('Erro ao salvar necessidade de HEAD:', error);
        throw error;
    }
    return data || [];
}

/**
 * Busca todos os lançamentos de pagamento de hora extra (50%/100%)
 */
async function fetchPagamentoHoraExtraDB() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    // O id entra como critério final porque (ano_mes_sort, funcionario_nome) não é
    // único — o mesmo colaborador tem linha de 50% e de 100% no mesmo mês. Sem ele a
    // ordem fica ambígua e as faixas paralelas podem repetir ou pular lançamentos.
    return fetchPaginadoDB((de, ate, comContagem) => client
        .from('pagamento_hora_extra')
        .select('*', comContagem ? { count: 'exact' } : undefined)
        .order('ano_mes_sort', { ascending: true })
        .order('funcionario_nome', { ascending: true })
        .order('id', { ascending: true })
        .range(de, ate), 'pagamento de hora extra');
}

/**
 * Substitui todos os lançamentos de um mês específico (ano_mes_sort) por um novo lote
 * importado da planilha. Apaga primeiro os registros existentes daquele mês para permitir
 * reimportação sem duplicar dados.
 */
async function importPagamentoHoraExtraMesDB(anoMesSort, records) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { error: delError } = await client
        .from('pagamento_hora_extra')
        .delete()
        .eq('ano_mes_sort', anoMesSort);

    if (delError) {
        console.error('Erro ao limpar mês antes da reimportação:', delError);
        throw delError;
    }

    if (!records || records.length === 0) return { count: 0 };

    const batchSize = 250;
    let insertedCount = 0;
    for (let i = 0; i < records.length; i += batchSize) {
        const chunk = records.slice(i, i + batchSize);
        const { error } = await client.from('pagamento_hora_extra').insert(chunk);
        if (error) {
            console.error(`Erro ao inserir lote ${i} de hora extra:`, error);
            throw error;
        }
        insertedCount += chunk.length;
    }

    return { count: insertedCount };
}

/**
 * Busca todos os registros de ponto usados no controle de interjornada
 * (entrada/saída diária por colaborador, importados do relatório PontoMais)
 */
async function fetchInterjornadaRegistrosDB() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    // (colaborador_nome, data_iso) é a chave única da tabela, então a ordem já é total.
    // Esta é a maior tabela do painel (~15 mil linhas): era ela que fazia a aba
    // InterJornadas levar ~11s para abrir, com 15 requisições em fila.
    return fetchPaginadoDB((de, ate, comContagem) => client
        .from('interjornada_registros')
        .select('*', comContagem ? { count: 'exact' } : undefined)
        .order('colaborador_nome', { ascending: true })
        .order('data_iso', { ascending: true })
        .range(de, ate), 'registros de interjornada');
}

/**
 * Insere/atualiza (upsert) em lote os registros de ponto importados da planilha
 * de interjornada. onConflict por (colaborador_nome, data_iso) permite reimportar
 * o mesmo período sem duplicar linhas.
 */
async function upsertInterjornadaRegistrosDB(records) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');
    if (!records || records.length === 0) return { count: 0 };

    const batchSize = 250;
    let upsertedCount = 0;
    for (let i = 0; i < records.length; i += batchSize) {
        const chunk = records.slice(i, i + batchSize);
        const { error } = await client
            .from('interjornada_registros')
            .upsert(chunk, { onConflict: 'colaborador_nome,data_iso' });
        if (error) {
            console.error(`Erro ao inserir lote ${i} de interjornada:`, error);
            throw error;
        }
        upsertedCount += chunk.length;
    }

    return { count: upsertedCount };
}

/**
 * Importacao em lote do cadastro de empregados. A chave e o nome (unique na tabela),
 * entao reimportar a mesma planilha atualiza em vez de duplicar.
 */
async function upsertColaboradoresDB(registros) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase nao inicializado');
    if (!registros || registros.length === 0) return { count: 0 };

    const lote = 250;
    let total = 0;
    for (let i = 0; i < registros.length; i += lote) {
        const chunk = registros.slice(i, i + lote);
        const { error } = await client
            .from('colaboradores')
            .upsert(chunk, { onConflict: 'nome' });
        if (error) {
            console.error(`Erro ao gravar lote ${i} de colaboradores:`, error);
            throw error;
        }
        total += chunk.length;
    }
    return { count: total };
}

/**
 * Troca o status de um colaborador (ATIVO / AFASTADO INSS / DEMITIDO).
 * Demissao e marcada no status, nao apagada: o historico de absenteismo, hora extra
 * e exames referencia a pessoa pelo nome, e apagar deixaria esses registros orfaos.
 */
async function updateColaboradorStatusDB(nome, status) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase nao inicializado');

    const { error } = await client
        .from('colaboradores')
        .update({ status })
        .eq('nome', nome);

    if (error) {
        console.error('Erro ao atualizar status do colaborador:', error);
        throw error;
    }
    return true;
}

/**
 * Empresa por colaborador definida a mao no painel.
 * A planilha de absenteismo nao traz empresa; o painel resolve cruzando o nome com o
 * cadastro de empregados e com o controle de exames. Quem nao esta em nenhum dos dois
 * e atribuido aqui, e passa a valer para toda importacao futura.
 */
async function fetchColaboradorEmpresaDB() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase nao inicializado');

    const { data, error } = await client
        .from('colaborador_empresa')
        .select('*')
        .order('funcionario_nome', { ascending: true });

    if (error) {
        if (error.code === '42P01' || /does not exist/i.test(error.message || '')) {
            console.warn('Tabela colaborador_empresa ainda nao existe no Supabase.');
            return [];
        }
        console.error('Erro ao buscar empresa por colaborador:', error);
        throw error;
    }
    return data || [];
}

async function upsertColaboradorEmpresaDB(registros) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase nao inicializado');
    if (!registros || registros.length === 0) return { count: 0 };

    const { error } = await client
        .from('colaborador_empresa')
        .upsert(registros, { onConflict: 'funcionario_chave' });

    if (error) {
        console.error('Erro ao gravar empresa por colaborador:', error);
        throw error;
    }
    return { count: registros.length };
}

/**
 * Busca o controle de exames periodicos (ASO) de todos os colaboradores.
 * Devolve [] quando a tabela ainda não existe no projeto, para o painel poder
 * cair na base local em vez de quebrar.
 */
async function fetchExamesPeriodicosDB() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('exames_periodicos')
        .select('*')
        .order('proximo_aso_iso', { ascending: true, nullsFirst: false })
        .order('funcionario', { ascending: true });

    if (error) {
        // 42P01 = tabela inexistente: ainda não rodaram a migração.
        if (error.code === '42P01' || /does not exist/i.test(error.message || '')) {
            console.warn('Tabela exames_periodicos ainda não existe no Supabase.');
            return [];
        }
        console.error('Erro ao buscar exames periódicos:', error);
        throw error;
    }
    return data || [];
}

/**
 * Substitui o controle de exames periódicos pelo conteúdo de uma nova planilha.
 * A planilha é sempre a foto completa do controle do RH, então o upsert usa o nome
 * do colaborador como chave e apaga quem não veio mais na lista (desligados).
 */
async function upsertExamesPeriodicosDB(records) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');
    if (!records || records.length === 0) return { count: 0 };

    const batchSize = 250;
    let total = 0;
    for (let i = 0; i < records.length; i += batchSize) {
        const chunk = records.slice(i, i + batchSize);
        const { error } = await client
            .from('exames_periodicos')
            .upsert(chunk, { onConflict: 'empresa,funcionario' });
        if (error) {
            console.error(`Erro ao gravar lote ${i} de exames periódicos:`, error);
            throw error;
        }
        total += chunk.length;
    }

    return { count: total };
}

/**
 * Exclui uma ocorrência pelo ID
 */
async function deleteOcorrenciaDB(id) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { error } = await client
        .from('ocorrencias_absenteismo')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Erro ao excluir ocorrência no Supabase:', error);
        throw error;
    }
    return true;
}

/**
 * Atualiza campos de uma ocorrência
 */
async function updateOcorrenciaDB(id, updates) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('ocorrencias_absenteismo')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select();

    if (error) {
        console.error('Erro ao atualizar ocorrência no Supabase:', error);
        throw error;
    }
    return data && data.length > 0 ? data[0] : null;
}

/**
 * Inscreve o frontend no Realtime do Supabase (PostgreSQL Changes)
 */
function subscribeToRealtime(onInsert, onUpdate, onDelete) {
    const client = getSupabaseClient();
    if (!client) return null;

    if (_realtimeSubscription) {
        client.removeChannel(_realtimeSubscription);
    }

    _realtimeSubscription = client
        .channel('absenteismo-realtime-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ocorrencias_absenteismo' }, (payload) => {
            console.log('⚡ [Realtime Supabase] Nova ocorrência inserida:', payload.new);
            if (onInsert) onInsert(payload.new);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ocorrencias_absenteismo' }, (payload) => {
            console.log('⚡ [Realtime Supabase] Ocorrência atualizada:', payload.new);
            if (onUpdate) onUpdate(payload.new);
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ocorrencias_absenteismo' }, (payload) => {
            console.log('⚡ [Realtime Supabase] Ocorrência excluída:', payload.old);
            if (onDelete) onDelete(payload.old);
        })
        .subscribe((status) => {
            console.log('📡 [Realtime Supabase] Status da Conexão:', status);
        });

    return _realtimeSubscription;
}

// Exporta para escopo global window
window.SupabaseService = {
    config: SUPABASE_CONFIG,
    getClient: getSupabaseClient,
    testConnection: testDatabaseConnection,
    fetchOcorrencias: fetchAbsenteismoFromDB,
    insertOcorrencia: insertOcorrenciaDB,
    bulkInsertOcorrencias: bulkInsertOcorrenciasDB,
    deleteOcorrencia: deleteOcorrenciaDB,
    updateOcorrencia: updateOcorrenciaDB,
    subscribeRealtime: subscribeToRealtime,
    fetchLatestImportId: fetchLatestImportIdDB,
    fetchHistorico: fetchHistoricoImportacoesDB,
    renameImportacao: renameImportacaoDB,
    fetchImportacaoById: fetchImportacaoByIdDB,
    saveDiagnosticoIA: saveDiagnosticoIADB,
    fetchTurnoverMensal: fetchTurnoverMensalDB,
    upsertTurnoverMensal: upsertTurnoverMensalDB,
    fetchColaboradores: fetchColaboradoresDB,
    insertColaborador: insertColaboradorDB,
    fetchHeadNecessidade: fetchHeadNecessidadeDB,
    upsertHeadNecessidade: upsertHeadNecessidadeDB,
    fetchPagamentoHoraExtra: fetchPagamentoHoraExtraDB,
    importPagamentoHoraExtraMes: importPagamentoHoraExtraMesDB,
    fetchInterjornadaRegistros: fetchInterjornadaRegistrosDB,
    upsertInterjornadaRegistros: upsertInterjornadaRegistrosDB,
    fetchExamesPeriodicos: fetchExamesPeriodicosDB,
    upsertExamesPeriodicos: upsertExamesPeriodicosDB,
    fetchColaboradorEmpresa: fetchColaboradorEmpresaDB,
    upsertColaboradorEmpresa: upsertColaboradorEmpresaDB,
    upsertColaboradores: upsertColaboradoresDB,
    updateColaboradorStatus: updateColaboradorStatusDB
};
