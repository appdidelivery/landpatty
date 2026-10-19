# Patty CRM — MVP (branch de teste)

Esta implementação não altera o WhatsApp Business no celular e não está ativa no site de produção enquanto não for feita a publicação.

## O que o MVP faz

- Formulário: nome, WhatsApp, serviço, referência PTY e origem da campanha.
- Captura no banco Firestore (servidor), com proteção Turnstile e formulário honeypot.
- A solicitação é registrada antes do redirecionamento ao WhatsApp.
- CRM mobile em /crm.html com login Firebase, allowlist de funcionários no backend e alterações de status, data, observações e receita.
- Privacidade: dados pessoais não são enviados ao GA4.

## Variáveis de ambiente necessárias

- FIREBASE_SERVICE_ACCOUNT_JSON: JSON da conta de serviço (secreto; somente backend)
- FIREBASE_WEB_API_KEY: chave da aplicação Web do Firebase (pública)
- FIREBASE_AUTH_DOMAIN: domínio Auth Firebase (público)
- FIREBASE_PROJECT_ID: ID do Firebase (público)
- FIREBASE_WEB_APP_ID: app ID do Firebase Web (público)
- CRM_ALLOWED_EMAILS: emails autorizados, separados por vírgula
- CRM_ALLOWED_ORIGINS: origens HTTPS exatas do site e do preview, separadas por vírgula
- TURNSTILE_SITE_KEY: site key do Cloudflare Turnstile (pública)
- TURNSTILE_SECRET_KEY: segredo de verificação do Cloudflare Turnstile (secreto)

## Passos antes de publicar

1. Identificar a hospedagem real do domínio pattycentrodebeleza.com.br. APIs Node em /api exigem hospedagem compatível (ex.: Vercel). Site estático puro não executa essas APIs.
2. Criar Firebase separado para Patty; habilitar Firestore e Authentication com Email/Senha.
3. Criar usuários somente pela administração do Firebase, marcar e-mails como verificados e preencher CRM_ALLOWED_EMAILS.
4. No Firestore, negar acesso direto dos clientes a patty_leads (regra allow read, write: if false). O Firebase Admin SDK do servidor tem acesso pelo service account.
5. Criar Turnstile, incluir os domínios corretos e configurar as chaves.
6. Configurar secrets apenas nas variáveis de ambiente da hospedagem; nunca colocar credenciais no GitHub, Analytics ou código web.
7. Validar texto de privacidade com a proprietária antes de publicar.
8. Gerar deploy preview, testar criação/duplicidade, acesso negado, status, receita, fallback de WhatsApp e integração GA4.
9. Publicar só depois da confirmação de que o domínio e as APIs estão na mesma hospedagem.

## Limitações

- Botões diretos de WhatsApp continuam registrando clique no GA4, sem identificação pessoal. Captura de conversa real só com a integração oficial WhatsApp Business Platform (coexistência, se elegível).
- Sem integração ao agendamento e caixa do salão, status de atendimento e faturamento exigem um toque da equipe.
- O painel apresenta indicadores dos registros carregados (até 100 por página) e não representa o total histórico enquanto houver mais páginas.
- Não é possível converter retroativamente cliques antigos do GA4 em leads identificados.
- Bloqueios de conexão/browser ou indisponibilidade da API podem impedir uma captura; nesse caso, o site mostra aviso de que o CRM não confirmou o registro e ainda abre o WhatsApp.
- Os custos da hospedagem e do Firebase exigem aprovação antes de ativação.

## Testes essenciais

- Capturar formulário em rede real com UTM e GCLID fictícios, sem enviar dados pessoais para GA4.
- Abrir WhatsApp Business com a referência PTY na mensagem, sem alterar número nem configuração do aplicativo.
- Testar token Turnstile inválido, dados inválidos, origem não autorizada e acesso ao CRM sem token (401), token fora da allowlist (403).
- Testar conta autorizada, atualizar status e receita e reler dados.
- Conferir rastreamento já existente via GTM/GA4, sem duplicação de eventos e sem perda de mobile PageSpeed.
