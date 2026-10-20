# Patty CRM — MVP (branch de teste)

Esta atualização remove a exigência de conta Cloudflare. A validação de envios funciona no backend; o WhatsApp Business permanece no celular.

## O que o MVP faz

- Formulário: nome, WhatsApp, serviço, referência PTY e origem da campanha.
- Captura no Firestore, com honeypot, validação de origem, dados e limites de envios transacionais por telefone/IP (identificadores em hash, não em claro).
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

## Passos antes de publicar

1. Identificar a hospedagem real do domínio pattycentrodebeleza.com.br. APIs Node em /api exigem hospedagem compatível (ex.: Vercel). Site estático puro não executa essas APIs.
2. Criar Firebase separado para Patty; habilitar Firestore e Authentication com Email/Senha.
3. Criar usuários somente pela administração do Firebase, marcar e-mails como verificados e preencher CRM_ALLOWED_EMAILS.
4. No Firestore, negar acesso direto dos clientes a patty_leads (regra allow read, write: if false). O Firebase Admin SDK do servidor tem acesso pelo service account.
5. Nenhuma conta Cloudflare é necessária. A coleção interna patty_capture_rate_limits controla abuso. Recomenda-se configurar TTL para o campo expiresAt dessa coleção no console Firestore, para limpeza automática.
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
- Testar limite de envios (HTTP 429), honeypot, dados inválidos, origem não autorizada e acesso ao CRM sem token (401), token fora da allowlist (403).
- Testar conta autorizada, atualizar status e receita e reler dados.
- Conferir rastreamento já existente via GTM/GA4, sem duplicação de eventos e sem perda de mobile PageSpeed.

## Observação sobre proteção anti-spam

Esta solução evita novos provedores, mas NÃO possui desafio anti-bot interativo. Use monitoramento de custos e tráfego, e considere ativar proteção adicional caso seja detectado abuso. Limites atuais: 3 envios em 15 minutos e 12/dia por telefone, além de 8 em 15 minutos e 40/dia por IP Vercel. O cliente sempre pode continuar pelo WhatsApp. Os documentos de limite incluem expiresAt; configurar TTL da coleção para limpeza automática é recomendado.

## Próxima evolução — cadastro manual e botões de serviços

- Cadastro manual em **Novo lead** com nome, telefone, origem, serviço, etapa, data, valor e observações; exige Firebase Auth e allowlist do CRM.
- Backend `POST /api/crm/leads` usa token Firebase, valida os campos e evita duplicação de mesmo serviço/telefone nas últimas 24h, quando o lead ainda está aberto.
- Nos cartões de serviços, o primeiro clique abre uma escolha: cadastrar nome/WhatsApp para acompanhamento no CRM ou continuar diretamente para o WhatsApp, sem cadastro.
- Cadastro rápido salva como `source=botao_servico` após ciência do aviso; o botão direto conta somente um evento `whatsapp_click` de intenção, sem pessoa identificada.
- Ao abrir a janela de cadastro, o evento é `whatsapp_cta_open`; `whatsapp_click` só ocorre quando a pessoa decide continuar ao WhatsApp. `crm_lead_saved` exige sucesso do backend.
- Botões da equipe e flutuante ainda permitem contato direto, registrando apenas cliques anônimos; isso NÃO confirma uma mensagem recebida. Captura automática da conversa exige conexão oficial WhatsApp Business Platform em coexistência, se elegível.
- Registros de testes devem ser separados dos leads de clientes reais. O site não confirma o envio efetivo da mensagem pelo WhatsApp.
- Teste manual: criar lead de WhatsApp e verificar a origem `cadastro_manual_whatsapp` no painel; mudar status, data e receita; recarregar a página.
- Teste de CTA: clicar em cada um dos oito serviços, optar por cadastrar (lead deve surgir no Firestore), escolher continuar sem dados (não deve surgir lead), cancelar (sem `whatsapp_click`).
- Validar UI no smartphone, click events GTM, deduplicação e tratamento de erros.


## Painel comercial: conversão e previsibilidade

Após merge e deploy, o CRM apresenta:
- Resultados por coorte de leads CRIADOS nos últimos 7 ou 30 dias: quantidade, status atual, porcentagem que chegou a agendado/atendido, receita efetivamente registrada, ticket médio e divisão por serviço/origem;
- Agenda futura de 30 dias: SOMA do valor previsto INFORMADO em cada agendamento confirmado, com contagem dos agendamentos ainda sem valor. **Não se trata de faturamento garantido**;
- Retornos vencidos de contatos ainda abertos. Defina a data de retorno no cadastro manual ou no detalhe;
- Motivos dos leads perdidos, para orientar ações comerciais;
- Marcador "registro de teste": excluir testes dos relatórios (inclusive o teste inicial feito antes desta atualização).

### Procedimento para Ana
1. Receber contato pelo site (automático) ou criar **Novo lead** para o que chegou diretamente por WhatsApp/Instagram/indicação.
2. Definir serviço, origem, data de retorno se precisar responder novamente e valor PREVISTO quando houver orçamento real.
3. Mover para "Agendado" ao confirmar data (registre também data e valor estimado). Nenhuma estimativa é receita recebida.
4. Mover para "Atendido" depois do serviço, registrando o valor EFETIVAMENTE recebido. O campo de receita realizada não deve ser preenchido com previsões.
5. Se não fechar, marcar "Perdido" e informar motivo. Registros fictícios: marcar "registro de teste".

### Atenções métricas
- "Receita realizada" nos relatórios é relativa aos leads criados no período, não equivale ao movimento financeiro/caixa do período. Evitar usar como conciliação fiscal ou relatório contábil.
- Indicadores dos cartões superiores antigos contam registros CARREGADOS no navegador; use a seção "Resultados comerciais" para indicadores agregados de coorte e agenda, que não incluem testes.
- A origem Google Ads só é reconhecida se o cadastro tiver os respectivos parâmetros identificáveis; não converter cliques GA4 em clientes.
- Relatórios têm limite de 1.000 registros por consulta e exibem aviso quando são parciais. Para redes maiores será necessário implementar agregação no servidor.
- CPA real e ROAS só poderão ser calculados com despesa comprovada, atribuição confiável e receita realizada; não inferir retorno de investimento apenas de cliques.
- Não existe automação para capturar mensagem recebida no WhatsApp Business aplicativo sem integração oficial em coexistência.
