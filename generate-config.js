/**
 * Gera supabase-config.js a partir de variaveis de ambiente no momento do build.
 * Roda no Vercel (Build Command) e localmente antes de abrir o dashboard.
 */
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const projectName = process.env.SUPABASE_PROJECT_NAME || 'RH Absenteísmo';

if (!url || !anonKey) {
    console.error('[generate-config] Faltam variaveis de ambiente obrigatorias: SUPABASE_URL e/ou SUPABASE_ANON_KEY.');
    console.error('[generate-config] Configure-as em Vercel > Project Settings > Environment Variables.');
    process.exit(1);
}

const projectRefMatch = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
const projectRef = projectRefMatch ? projectRefMatch[1] : '';

const fileContent = `// Arquivo gerado automaticamente pelo generate-config.js durante o build.
// NAO EDITE MANUALMENTE E NAO FACA COMMIT DESTE ARQUIVO (veja .gitignore).
window.__SUPABASE_CONFIG__ = {
    url: ${JSON.stringify(url)},
    anonKey: ${JSON.stringify(anonKey)},
    projectName: ${JSON.stringify(projectName)},
    projectRef: ${JSON.stringify(projectRef)}
};
`;

fs.writeFileSync(path.join(__dirname, 'supabase-config.js'), fileContent, 'utf8');
console.log('[generate-config] supabase-config.js gerado com sucesso para o projeto:', projectRef || url);
