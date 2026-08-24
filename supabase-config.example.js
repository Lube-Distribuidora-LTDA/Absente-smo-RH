// Modelo de referencia. NAO contem credenciais reais.
// Para rodar localmente:
//   1) SUPABASE_URL=https://SEU_REF.supabase.co SUPABASE_ANON_KEY=SUA_ANON_KEY npm run build
//   2) Isso gera o supabase-config.js real (gitignored) usado pelo index.html
window.__SUPABASE_CONFIG__ = {
    url: 'https://SEU_PROJECT_REF.supabase.co',
    anonKey: 'SUA_ANON_KEY_AQUI',
    projectName: 'RH Absenteísmo',
    projectRef: 'SEU_PROJECT_REF'
};
