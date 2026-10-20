# Patty | Atribuição e conversões de campanhas

## Modelo de mensuração
Separamos etapas: clique no anúncio, interação no site, lead identificado, agendamento, atendimento, receita recebida. Nunca somar essas etapas como se fossem todas clientes.

## Registro da campanha
Ao chegar ao site, o navegador conserva na aba atual a primeira e a última origem identificadas, mediante sessionStorage. Registra parâmetros de campanha UTM, gclid/gbraid/wbraid (Google), fbclid (Meta), msclkid (Microsoft), ttclid (TikTok), IDs de campanha/criativo quando presentes, domínio de referência e caminho da landing sem dados de query. O envio ao Firestore acontece somente quando o lead preenche o formulário principal ou o cadastro opcional do botão WhatsApp. As APIs sanitizam os campos antes de salvar.

Classificação: click_id_detected = ID de clique presente na URL, não prova de despesa; utm_tagged = origem declarada no link; referrer_only = inferência pelo referrer; unknown = não identificada; cadastro_manual_* = origem informada pela equipe, sem verificação técnica. Primeiro/último toque valem somente dentro da mesma aba; sessões fechadas, bloqueios e navegação entre dispositivos podem interromper a trilha. Registros anteriores não ganham IDs retroativos.

## Configuração recomendada dos links de anúncios
Google Ads: manter a marcação automática atual. Considerar Final URL suffix (após revisar parâmetros existentes):
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}&ad_id={creative}&device={device}&network={network}&utm_term={keyword}
Não adicionar gclid manualmente; ValueTrack fornece IDs, não nomes legíveis. Confirmar suporte por tipo de campanha e não duplicar parâmetros da URL final.

Meta Instagram Ads: adicionar UTMs aos links de destino, por exemplo:
utm_source=instagram&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}
Validar as macros no painel Meta antes de lançar. Links de Instagram orgânico: usar utm_source=instagram&utm_medium=organic_social&utm_campaign=perfil.

## Eventos GTM / GA4
- whatsapp_cta_open: abriu o cadastro opcional. Interação, não conversão.
- whatsapp_click: abriu um link WhatsApp. Não comprova mensagem recebida.
- form_agendamento_submit: tentativa de envio do formulário.
- crm_lead_saved: backend confirmou lead identificado. Candidato a conversão principal após auditoria.
- crm_capture_failed: captação falhou.
- reel_play: clique para reproduzir Reel incorporado; não comprova visualização completa.
- social_outbound_click: clique para abrir rede social externa; não comprova lead.
- maps_click / phone_click / site_navigation_click: interações auxiliares.

Não marcar whatsapp_click e crm_lead_saved simultaneamente como metas primárias de otimização para o mesmo objetivo sem revisar as ações de conversão. Eventos de agendamento, atendimento e faturamento residem no CRM e NÃO são enviados automaticamente ao GA4 ou Google Ads; upload offline depende de integração específica, permissão, validação de tempo/valor e deduplicação pela referência PTY. Nunca enviar nome, telefone ou ID de clique em parâmetros personalizados para o GA4.

## Todos os botões
Serviços, profissionais, WhatsApp flutuante e CTA dos Reels oferecem cadastro opcional antes de abrir o WhatsApp; usuário pode optar por continuar sem cadastro. Nome/telefone só são gravados no CRM se fornecidos. Os botões de profissionais salvam nome da profissional; CTA dos vídeos pode salvar o ID do último Reel clicado. Cliques dentro do iframe do Instagram não podem ser medidos pelo site por isolamento de origem.

## Critérios de aceite
1. URL com UTM/IDs de teste -> lead hero salvo -> primeira/última origem, campanha, CTA hero e referência PTY no CRM.
2. Botão da equipe -> lead salvo -> cta.area=equipe e profissional correta.
3. WhatsApp flutuante -> lead salvo -> área flutuante; opção de ir direto não cria lead.
4. Botão de serviço -> modal opcional e serviço identificado; cancelar não gera whatsapp_click.
5. Reel -> reel_play; CTA vídeos -> lead com área destaques e reelId, se houve play.
6. Ícones Instagram/Facebook -> social_outbound_click, sem criação automática de lead.
7. Testar GA4 DebugView/GTM preview, aplicativos móveis, consentimento, adblock e eventos duplicados antes de modificar metas do Ads.
8. Validar texto de privacidade com a Patty antes de ampliar utilização comercial dos dados.
9. Para ROAS, custo por agendamento e nome de campanha real, conciliar o CRM com despesas e metadados nas próprias plataformas Ads; UTMs por si só não fornecem gasto.
