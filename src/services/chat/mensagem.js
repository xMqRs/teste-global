const { EmbedBuilder } = require('@fluxerjs/core');
const { client } = require('../../lib/client');
const { DONO_ID, MUBI_ID, COR_EMBED_MUBI, ROTULO_BADGE, ehDev, NOME_WEBHOOK_MAX } = require('../../config');
const User = require('../../models/User');
const Guild = require('../../models/Guild');
const { corDaBadge, badgeAtiva } = require('../badges');
const { limitar } = require('../../util/conversao');

const CONTEUDO_MAX = 2000;
const DESCRICAO_EMBED_MAX = 4096;
const RESERVA_MENCAO = 40;
const ROTULO_PLATAFORMA = { fluxer: 'Fluxer', discord: 'Discord' };

function escaparMarkdown(texto) {
  return String(texto).replace(/[\\`*_~|[\]<>]/g, '\\$&');
}

function discriminadorVisivel(discriminator) {
  if (discriminator === undefined || discriminator === null) return false;
  return String(discriminator) !== '0';
}

function etiquetaDoUsuario(nickname, username, discriminator) {
  const tag = discriminadorVisivel(discriminator) ? `#${discriminator}` : '';
  return `${nickname} (@${username}${tag})`;
}

function obterIconeServidor(g) {
  if (!g) return null;

  if (typeof g.iconURL === 'function') {
    try {
      const url = g.iconURL({ extension: 'gif', forceStatic: false, size: 128 }) || g.iconURL();
      if (url) return url;
    } catch (_) {
      try {
        const url = g.iconURL();
        if (url) return url;
      } catch (_) {}
    }
  }

  if (g.icon) {
    const animado = String(g.icon).startsWith('a_');
    const ext = animado ? 'gif' : 'png';
    return `https://fluxerusercontent.com/icons/${g.id}/${g.icon}.${ext}?size=128`;
  }

  return null;
}

function montarNomeWebhook(nickname, username, discriminator, rotulo, origem) {
  const tag = discriminadorVisivel(discriminator) ? `#${discriminator}` : '';
  const prefixo = origem ? `[${origem}] ` : '';
  const sufixo = ` (@${username}${tag})${rotulo ? ` — ${rotulo}` : ''}`;
  const espaco = NOME_WEBHOOK_MAX - sufixo.length - prefixo.length;

  let nick = String(nickname);
  if (nick.length > espaco) nick = espaco > 1 ? `${nick.slice(0, espaco - 1)}…` : nick.slice(0, 1);
  return `${prefixo}${nick}${sufixo}`.slice(0, NOME_WEBHOOK_MAX);
}

function urlDoPerfil(plataforma, autorId) {
  return plataforma === 'discord'
    ? `https://discord.com/users/${autorId}`
    : `https://web.fluxer.app/users/${autorId}`;
}

async function infoMensagem(message) {
  const autor = message.author;
  const plataforma = message.plataforma || 'fluxer';
  const guildId = String(message.guildId || (message.guild ? message.guild.id : '0'));
  const g = message.guild || (plataforma === 'fluxer' ? client.guilds.get(guildId) : null);
  const nomeServidor = g && g.name ? g.name : 'Servidor Desconhecido';

  const nickname = autor.globalName || autor.displayName || autor.username;
  const username = autor.username;

  const config = await Guild.findOne({ guildId }).select('ocultarServidor ocultarPerfil mostrarIcone cor').lean();
  const usuario = await User.findOne({ userId: String(autor.id) }).select('staff badges selectedBadge').lean();
  const badge = badgeAtiva(usuario);

  let urlMidia = null;
  if (message.attachments && message.attachments.size > 0) {
    urlMidia = message.attachments.first().url;
  }
  if (!urlMidia) {
    const figurinhas = message.stickers;
    const figurinha = Array.isArray(figurinhas) ? figurinhas[0] : (figurinhas && figurinhas.first ? figurinhas.first() : null);
    if (figurinha && figurinha.url && !/\.json(\?|$)/i.test(figurinha.url)) {
      urlMidia = figurinha.url;
    }
  }

  const rotulo = ehDev(autor.id) ? ROTULO_BADGE.developer : (badge ? ROTULO_BADGE[badge] : null);
  const rotuloBadge = rotulo;
  const iconeServidor = !config || config.mostrarIcone !== false ? obterIconeServidor(g) : null;
  const etiqueta = etiquetaDoUsuario(nickname, username, autor.discriminator);
  let authorText = etiqueta;
  let corEmbed = corDaBadge(usuario) ?? (config && config.cor != null ? config.cor : 0x0B0B0B);
  if (autor.id === DONO_ID) {
    authorText = `${etiqueta} - Desenvolvedor do Global`;
    corEmbed = 0xC0B29D;
  } else if (autor.id === MUBI_ID) {
    authorText = `${etiqueta} - Desenvolvedor do Global`;
    corEmbed = COR_EMBED_MUBI;
  } else if (badge) {
    authorText = `${etiqueta} - ${ROTULO_BADGE[badge]}`;
  }
  const perfilUrl = urlDoPerfil(plataforma, autor.id);
  const avatarUrl = autor.displayAvatarURL ? autor.displayAvatarURL() : null;

  return {
    plataforma,
    ocultarServidor: !!(config && config.ocultarServidor),
    ocultarPerfil: !!(config && config.ocultarPerfil),
    rotuloOrigem: ROTULO_PLATAFORMA[plataforma] || plataforma,
    guildId,
    nomeServidor,
    urlMidia,
    nickname,
    username,
    discriminator: autor.discriminator,
    rotuloBadge,
    iconeServidor,
    authorText,
    corEmbed,
    perfilUrl,
    avatarUrl
  };
}

function montarConteudoWebhook(message, info, links = [], opcoes = {}) {
  const conteudo = opcoes.conteudo === undefined ? message.content : opcoes.conteudo;
  const partes = [];
  if (!info.ocultarServidor) partes.push(escaparMarkdown(info.nomeServidor));
  if (!info.ocultarPerfil) partes.push(`[Ver perfil](<${info.perfilUrl}>)`);
  const rodape = partes.length ? `-# ${partes.join(' — ')}` : '';
  const texto = [conteudo || '', ...links].filter(Boolean).join('\n');
  const limite = CONTEUDO_MAX - rodape.length - RESERVA_MENCAO;
  const corpo = texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
  return [corpo, rodape].filter(Boolean).join('\n');
}

function montarPayloadWebhook(message, info, anexos = { arquivos: [], links: [] }, opcoes = {}) {
  const payload = {
    username: montarNomeWebhook(info.nickname, info.username, info.discriminator, info.rotuloBadge, opcoes.rotulo),
    content: montarConteudoWebhook(message, info, anexos.links, opcoes),
    allowedMentions: { parse: [] }
  };
  if (info.avatarUrl) payload.avatarUrl = info.avatarUrl;
  if (anexos.arquivos.length > 0) payload.files = anexos.arquivos;
  return payload;
}

function montarCorpoEdicaoWebhook(message, info, opcoes = {}) {
  return {
    content: montarConteudoWebhook(message, info, [], opcoes),
    allowedMentions: { parse: [] }
  };
}

function textoAutorEmbed(info, opcoes) {
  return opcoes.rotulo ? `[${opcoes.rotulo}] ${info.authorText}` : info.authorText;
}

function montarEmbedGlobal(message, info, opcoes = {}) {
  const autor = message.author;
  const avatarUrl = autor.displayAvatarURL ? autor.displayAvatarURL() : null;
  const conteudo = opcoes.conteudo === undefined ? message.content : opcoes.conteudo;

  const embed = new EmbedBuilder()
    .setDescription(conteudo ? conteudo : null)
    .setColor(info.corEmbed)
    .setAuthor({ name: textoAutorEmbed(info, opcoes), iconURL: avatarUrl, ...(info.ocultarPerfil ? {} : { url: info.perfilUrl }) });
  if (!info.ocultarServidor) {
    const footer = { text: info.nomeServidor };
    if (info.iconeServidor) footer.iconURL = info.iconeServidor;
    embed.setFooter(footer);
  }
  if (info.urlMidia) embed.setImage(info.urlMidia);
  return embed;
}

function montarEmbedJson(message, info, opcoes = {}) {
  const autor = message.author;
  const avatarUrl = autor.displayAvatarURL ? autor.displayAvatarURL() : null;
  const conteudo = opcoes.conteudo === undefined ? message.content : opcoes.conteudo;

  const embed = {
    color: info.corEmbed,
    author: { name: limitar(textoAutorEmbed(info, opcoes), 256) }
  };
  if (!info.ocultarPerfil) embed.author.url = info.perfilUrl;
  if (!info.ocultarServidor) {
    embed.footer = { text: limitar(info.nomeServidor, 2048) };
    if (info.iconeServidor) embed.footer.icon_url = info.iconeServidor;
  }
  if (conteudo) embed.description = limitar(conteudo, DESCRICAO_EMBED_MAX);
  if (avatarUrl) embed.author.icon_url = avatarUrl;
  if (info.urlMidia) embed.image = { url: info.urlMidia };
  return embed;
}

module.exports = {
  infoMensagem,
  montarEmbedGlobal,
  montarEmbedJson,
  montarPayloadWebhook,
  montarCorpoEdicaoWebhook
};
