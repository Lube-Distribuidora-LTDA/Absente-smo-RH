/**
 * =========================================================================
 * SUPABASE CLIENT & DATA LAYER - BI DE ABSENTEÍSMO RH (LUBE DISTRIBUIDORA)
 * =========================================================================
 * Integração 100% dinâmica com banco de dados PostgreSQL do Supabase.
 * Suporta leitura em alta velocidade, inserções manuais, importação em lote,
 * auditoria e sincronização em tempo real (PostgreSQL Realtime).
 */

const SUPABASE_CONFIG = {
    url: 'https://issujcvninltzvxdfhqd.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlzc3VqY3ZuaW5sdHp2eGRmaHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMDIyMzIsImV4cCI6MjEwMjg3ODIzMn0.hvZbM6WSlq3mi3KGC9n7PqA54dZpdWhFgcMYzcNnQ5g',
    projectName: 'ABSENTEISMO RH',
    projectRef: 'issujcvninltzvxdfhqd'
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
 * Busca todas as ocorrências de absenteísmo no Supabase
 */
async function fetchAbsenteismoFromDB() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    // Supabase REST limita a 1000 por página por padrão; fazemos paginação em blocos se passar de 1000
    let allRecords = [];
    let from = 0;
    const step = 1000;
    let keepFetching = true;

    while (keepFetching) {
        const { data, error } = await client
            .from('ocorrencias_absenteismo')
            .select('*')
            .order('data_iso', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + step - 1);

        if (error) {
            console.error('Erro ao buscar dados de absenteísmo:', error);
            throw error;
        }

        if (data && data.length > 0) {
            allRecords = allRecords.concat(data);
            if (data.length < step) {
                keepFetching = false;
            } else {
                from += step;
            }
        } else {
            keepFetching = false;
        }
    }

    return allRecords;
}

/**
 * Insere uma nova ocorrência de absenteísmo manualmente no Supabase
 */
async function insertOcorrenciaDB(record) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    const { data, error } = await client
        .from('ocorrencias_absenteismo')
        .insert([record])
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
 * Insere múltiplos registros no Supabase em lote (ex.: importação Excel)
 * e registra no histórico de importações
 */
async function bulkInsertOcorrenciasDB(records, fileName = 'Importacao_Planilha.xlsx', sheetName = 'BASE') {
    const client = getSupabaseClient();
    if (!client) throw new Error('Cliente Supabase não inicializado');

    if (!records || records.length === 0) return { count: 0 };

    const batchSize = 250;
    let insertedCount = 0;

    // Formata campos para garantir compatibilidade com colunas do banco
    const sanitized = records.map(r => {
        const row = { ...r };
        delete row.id; // Deixa o PostgreSQL gerar o ID sequencial oficial
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

    // Registra no histórico de importações
    try {
        await client.from('historico_importacoes').insert([{
            nome_arquivo: fileName,
            total_registros: insertedCount,
            aba_origem: sheetName,
            status: 'CONCLUIDO',
            usuario: 'RH Lube',
            detalhes: { data_hora: new Date().toISOString(), total_processado: insertedCount }
        }]);
    } catch (e) {
        console.warn('Falha ao registrar histórico de importação:', e);
    }

    return { count: insertedCount };
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
    subscribeRealtime: subscribeToRealtime
};
