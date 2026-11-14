const { client } = require('../lib/client');
const { MODO_ENVIO } = require('../config');
const { log, errMsg } = require('../util/logger');
const { ehRateLimit, marcarEnvio } = require('../util/ratelimit');
const { enfileirar } = require('../services/entrega/fila');
const {
  enviarMensagem,
  enviarPorWebhook,
  editarMensagem,
  editarMensagemWebhook,
  apagarCopia: apagarCopiaNoTransporte
} = require('../services/entrega/transporte');
const { montarEmbedGlobal, montarPayloadWebhook, montarCorpoEdicaoWebhook } = require('../services/chat/mensagem');
const { ErroSemWebhook } = require('../services/entrega/semWebhook');

function payloadWebhookDoDestino(base, mencao, origemReply) {
  if (!mencao) return base;
  return {
    ...base,
    content: `${mencao}\n${base.content}`,
    allowedMentions: { parse: [], users: [origemReply.autorId], repliedUser: false }
  };
}

function criarPreparo({ message, info, obterAnexos, conteudo, rotulo }) {
  const opcoes = { conteudo, rotulo };

  let embed = null;
  try {
    embed = montarEmbedGlobal(message, info, opcoes);
  } catch (e) {
    log.warn('GLOBAL', `Falha ao montar embed, usando texto simples: ${errMsg(e)}`);
  }

  let payloadPronto = null;
  const payloadWebhook = () => {
    if (!payloadPronto) {
      payloadPronto = obterAnexos().then((anexos) => montarPayloadWebhook(message, info, anexos, opcoes));
    }
    return payloadPronto;
  };

  return { embed, payloadWebhook, conteudo };
}

async function entregarPorEmbed(destino, entrega) {
  const { info, preparo, mencao, origemReply, alvoReply } = entrega;
  marcarEnvio(destino.canalId);

  const extraMencao = mencao
    ? { allowedMentions: { users: [origemReply.autorId], repliedUser: false } }
    : {};

  const payload = preparo.embed
    ? { embeds: [preparo.embed], ...(mencao ? { content: mencao } : {}) }
    : { content: `${mencao ? mencao + '\n' : ''}👤 **${info.authorText}**\n${preparo.conteudo || ''}\n${info.urlMidia || ''}` };

  let enviada;
  let comReply = false;
  if (alvoReply) {
    try {
      enviada = await client.channels.send(destino.canalId, {
        ...payload,
        ...extraMencao,
        replyTo: { channelId: alvoReply.canalId, messageId: alvoReply.msgId, guildId: destino.guildId },
        ping: false
      });
      comReply = true;
    } catch (e) {
      if (ehRateLimit(e)) throw e;
      log.warn('GLOBAL', `Reply falhou no servidor ${destino.guildId}, enviando sem reply: ${errMsg(e)}`);
    }
  }
  if (!enviada) enviada = await client.channels.send(destino.canalId, { ...payload, ...extraMencao });

  return { guildId: destino.guildId, canalId: destino.canalId, msgId: enviada.id, comReply };
}

async function entregarPorWebhookFluxer(destino, entrega) {
  const { preparo, mencao, origemReply, alvoReply } = entrega;

  const base = await preparo.payloadWebhook();
  const enviada = await enviarPorWebhook(destino, payloadWebhookDoDestino(base, mencao, origemReply), alvoReply);
  if (!enviada) throw new ErroSemWebhook(destino);
  if (!enviada.mensagem || !enviada.mensagem.id) throw new Error('Webhook não retornou a mensagem criada');

  return {
    guildId: destino.guildId,
    canalId: destino.canalId,
    msgId: enviada.mensagem.id,
    comReply: enviada.comReply,
    webhookId: enviada.webhookId
  };
}

function entregar(destino, entrega) {
  return (destino.modoEnvio || MODO_ENVIO) === 'webhook'
    ? entregarPorWebhookFluxer(destino, entrega)
    : entregarPorEmbed(destino, entrega);
}

function montarEdicao(message, info, opcoes) {
  return {
    corpoEmbed: { embeds: [montarEmbedGlobal(message, info, opcoes).toJSON()] },
    corpoWebhook: montarCorpoEdicaoWebhook(message, info, opcoes)
  };
}

async function editarCopia(copia, edicao, credenciais) {
  if (copia.webhookId) return editarMensagemWebhook(copia, credenciais, edicao.corpoWebhook);
  await editarMensagem(copia.canalId, copia.msgId, edicao.corpoEmbed);
  return 'editada';
}

function apagarCopia(copia, credenciais) {
  return apagarCopiaNoTransporte(copia, credenciais);
}

async function buscarMensagem(canalId, msgId) {
  const canal = await client.channels.fetch(String(canalId));
  return canal.messages.fetch(String(msgId));
}

function buscarUsuario(userId) {
  return client.users.fetch(String(userId));
}

function nomeServidor(guildId) {
  const guild = client.guilds.get(String(guildId));
  return guild && guild.name ? guild.name : null;
}

function enviarAnuncio(canalId, _anuncio, embed) {
  return enviarMensagem(canalId, { embeds: [embed] });
}

function enviarAviso(canalId, texto) {
  return enviarMensagem(canalId, { content: texto });
}

module.exports = {
  nome: 'fluxer',
  enfileirar,
  criarPreparo,
  entregar,
  montarEdicao,
  editarCopia,
  apagarCopia,
  buscarMensagem,
  buscarUsuario,
  nomeServidor,
  enviarAnuncio,
  enviarAviso
};
