/**
 * Vercel Serverless Function: gera o "Diagnóstico Executivo Automatizado de RH"
 * usando um modelo de IA (NVIDIA NIM / DeepSeek), a partir de estatísticas
 * agregadas e anonimizadas de absenteísmo (sem nomes de colaboradores).
 *
 * A chave da API (NVIDIA_API_KEY) fica apenas nesta função, do lado do
 * servidor, lida em runtime via variável de ambiente da Vercel. Ela NUNCA
 * é enviada ao navegador do usuário.
 */

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL = 'moonshotai/kimi-k3';
const ALLOWED_COLORS = ['blue', 'red', 'amber', 'emerald', 'purple', 'cyan'];

function buildPrompt(statsJson) {
    return `Você é um analista sênior de People Analytics de RH. Com base nestes dados AGREGADOS e ANONIMIZADOS de absenteísmo (sem nomes de colaboradores), gere um diagnóstico executivo em português do Brasil, direto e acionável para a diretoria.

DADOS:
${statsJson}

Responda ESTRITAMENTE com um array JSON (sem markdown, sem texto fora do array) de exatamente 4 objetos, cada um com os campos:
- "icon": um nome de ícone da biblioteca Lucide (ex: "map-pin", "calendar-alert", "shield-alert", "calendar-check", "trending-up", "users", "alert-triangle")
- "color": uma destas cores: "blue", "red", "amber", "emerald", "purple", "cyan"
- "title": título curto (máx 5 palavras)
- "text": 1 a 2 frases, citando números/percentuais reais dos dados fornecidos, terminando com uma conclusão ou recomendação prática de RH.

Cada card deve abordar um ângulo diferente (ex: setor crítico, padrão temporal/dia da semana, severidade disciplinar, tendência ao longo dos meses, gestão de folgas/banco de horas). Não invente números que não estejam nos dados fornecidos.`;
}

function extractJsonArray(raw) {
    let cleaned = raw.trim();
    // Remove markdown code fences, caso o modelo os inclua mesmo sendo instruído a não fazer isso
    cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
        cleaned = cleaned.slice(start, end + 1);
    }
    return JSON.parse(cleaned);
}

function sanitizeCards(cards) {
    if (!Array.isArray(cards)) return [];
    return cards.slice(0, 4).map(c => ({
        icon: (c && typeof c.icon === 'string' && c.icon.trim()) ? c.icon.trim().slice(0, 40) : 'sparkles',
        color: (c && ALLOWED_COLORS.includes(c.color)) ? c.color : 'cyan',
        title: (c && typeof c.title === 'string') ? c.title.trim().slice(0, 80) : 'Insight',
        text: (c && typeof c.text === 'string') ? c.text.trim().slice(0, 400) : ''
    })).filter(c => c.text.length > 0);
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

    const stats = req.body && req.body.stats;
    if (!stats || typeof stats !== 'object') {
        res.status(400).json({ error: 'Payload "stats" ausente ou inválido' });
        return;
    }

    // Limite defensivo de tamanho do payload enviado ao modelo
    const statsJson = JSON.stringify(stats).slice(0, 8000);

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
                    messages: [{ role: 'user', content: buildPrompt(statsJson) }],
                    temperature: 0.4,
                    top_p: 0.95,
                    max_tokens: 1200,
                    stream: false
                }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!upstream.ok) {
            const errText = await upstream.text().catch(() => '');
            console.error('[diagnostico] Erro upstream NVIDIA:', upstream.status, errText.slice(0, 500));
            res.status(502).json({ error: 'Falha ao consultar o modelo de IA' });
            return;
        }

        const payload = await upstream.json();
        const raw = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
        if (!raw) {
            res.status(502).json({ error: 'Resposta vazia do modelo de IA' });
            return;
        }

        let parsed;
        try {
            parsed = extractJsonArray(raw);
        } catch (parseErr) {
            console.error('[diagnostico] Falha ao parsear JSON do modelo:', parseErr.message, String(raw).slice(0, 500));
            res.status(502).json({ error: 'Resposta do modelo em formato inválido' });
            return;
        }

        const cards = sanitizeCards(parsed);
        if (cards.length === 0) {
            res.status(502).json({ error: 'Nenhum insight válido retornado pelo modelo' });
            return;
        }

        res.status(200).json({ cards });
    } catch (err) {
        console.error('[diagnostico] Erro inesperado:', err.message);
        res.status(500).json({ error: 'Erro interno ao gerar diagnóstico' });
    }
};
