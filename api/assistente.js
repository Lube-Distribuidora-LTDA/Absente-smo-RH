/**
 * Vercel Serverless Function: "Assistente Virtual do RH".
 *
 * Responde perguntas do usuário sobre a lógica e os números do dashboard
 * (Absenteísmo, Turnover, Listagem de Empregados), usando IA (NVIDIA NIM)
 * com o contexto de dados ao vivo enviado pelo cliente (agregados/anonimizados,
 * sem nomes de colaboradores).
 *
 * A chave da API (NVIDIA_API_KEY) fica apenas nesta função, do lado do
 * servidor, lida em runtime via variável de ambiente da Vercel. Ela NUNCA
 * é enviada ao navegador do usuário.
 *
 * Este assistente é SOMENTE EXPLICATIVO: ele não altera dados nem lógica de
 * cálculo do sistema, apenas responde perguntas com base no contexto fornecido.
 */

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL = 'moonshotai/kimi-k3';

const SYSTEM_PROMPT = `Você é o "Assistente Virtual do RH" da Lube Distribuidora, integrado a um dashboard de BI de RH. Seu papel é EXPLICAR, em português do Brasil, de forma clara e direta, como os números e a lógica do sistema funcionam. Você NÃO tem permissão para alterar dados, fórmulas ou configurações do sistema - se o usuário pedir para mudar a lógica de cálculo, explique educadamente que essa capacidade ainda não está habilitada e que ele deve pedir isso ao desenvolvedor do sistema.

Você tem 3 módulos para explicar:

1. ABSENTEÍSMO: cada ocorrência é classificada automaticamente pelo campo "motivo": se contém "falta" (e não "abono"/"abonado") ou "suspensão" → tipo "Injustificado"; se contém "atestado", "abono", "declaração" ou "licença" → tipo "Justificado"; outros motivos específicos mapeiam para "Compensacao/Folga" (folgas, banco de horas, trocas de feriado) ou "Desenvolvimento" (treinamentos/capacitações). Os KPIs (Faltas Injustificadas, Atestados, Folgas, Capacitações) são contagens diretas desses tipos sobre os dados filtrados, com percentuais sobre o total.

2. TURNOVER: a fórmula usada é Turnover% = ((Entradas + Saídas) / 2) ÷ Colaboradores do mês anterior × 100, calculada separadamente para CADA setor/localização e dentro do MESMO ano (nunca soma ou encadeia dados de anos diferentes). Quando não existe um mês anterior na série (ex: o primeiro mês registrado de um setor), o turnover aparece como "—" (sem base de comparação) em vez de gerar erro. IMPORTANTE - efeito de "base pequena": setores com poucos colaboradores podem mostrar percentuais de turnover extremamente altos (ex: 450%) mesmo com movimentações pequenas em número absoluto, porque o denominador (colaboradores do mês anterior) é muito baixo. Isso é matematicamente correto, não é um erro - reflete que a base de comparação era pequena, comum em unidades novas ou em expansão.

3. LISTAGEM DE EMPREGADOS: cadastro de colaboradores com nome, empresa, função, data de admissão e último exame ocupacional. "Tempo de casa" é calculado a partir da data de admissão até hoje.

Responda de forma objetiva (poucos parágrafos curtos, pode usar bullet points), citando números reais do contexto de dados fornecido quando relevante. Nunca invente números que não estejam no contexto.`;

function buildContextBlock(context) {
    try {
        return JSON.stringify(context).slice(0, 6000);
    } catch (e) {
        return '{}';
    }
}

function sanitizeMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-12) // limita o historico enviado por requisicao
        .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Método não permitido' });
        return;
    }

    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
        res.status(500).json({ error: 'NVIDIA_API_KEY não configurada no ambiente do servidor' });
        return;
    }

    const messages = sanitizeMessages(req.body && req.body.messages);
    if (messages.length === 0) {
        res.status(400).json({ error: 'Nenhuma mensagem enviada' });
        return;
    }

    const context = (req.body && req.body.context) || {};
    const contextJson = buildContextBlock(context);

    const chatMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: `CONTEXTO DE DADOS AO VIVO (seção ativa e números atuais do dashboard, JSON):\n${contextJson}` },
        ...messages
    ];

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 55000);

        let upstream;
        try {
            upstream = await fetch(NVIDIA_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: NVIDIA_MODEL,
                    messages: chatMessages,
                    temperature: 0.4,
                    top_p: 0.95,
                    max_tokens: 700,
                    stream: false
                }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!upstream.ok) {
            const errText = await upstream.text().catch(() => '');
            console.error('[assistente] Erro upstream NVIDIA:', upstream.status, errText.slice(0, 500));
            res.status(502).json({ error: 'Falha ao consultar o assistente de IA' });
            return;
        }

        const payload = await upstream.json();
        const reply = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
        if (!reply) {
            res.status(502).json({ error: 'Resposta vazia do assistente de IA' });
            return;
        }

        res.status(200).json({ reply: reply.trim().slice(0, 3000) });
    } catch (err) {
        console.error('[assistente] Erro inesperado:', err.message);
        res.status(500).json({ error: 'Erro interno ao consultar o assistente' });
    }
};
