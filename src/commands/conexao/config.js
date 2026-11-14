const { PREFIXO } = require('../../config');
const Guild = require('../../models/Guild');
const { idDoServidor } = require('../../util/ids');
const { log, descreverContexto } = require('../../util/logger');
const { temPermissaoConfig } = require('../../services/permissoes');

const LIGADO = '<:togglefill:1562606683371339783>';
const DESLIGADO = '<:toggleline:1562606683371339782>';
const INFO = '<:information2fill:1562606683371339784>';

function estadoDoWebhook(config) {
  const ativo = !!config.webhookId && config.webhookCanalId === config.canalId;
  return ativo
    ? `${LIGADO} **Webhook** · ativo neste canal`
    : `${DESLIGADO} **Webhook** · ainda não criado\n-# Ele é criado na primeira mensagem. O Global precisa da permissão **Gerenciar Webhooks** no canal.`;
}

function montarStatus(config) {
  const conexao = config.canalId
    ? `${INFO} Conexão global: <#${config.canalId}>${config.pausado ? ' (pausada)' : ''}`
    : `${INFO} Este servidor não está conectado, use \`${PREFIXO}conectar\`.`;

  return [
    '# Configurações do Global',
    '',
    conexao,
    '',
    config.canalId ? estadoDoWebhook(config) : null,
    config.canalId ? '' : null,
    `${config.filtrarPalavroes !== false ? LIGADO : DESLIGADO} **Filtro de palavrões**`,
    `${config.filtrarLinks ? LIGADO : DESLIGADO} **Filtro de links**`,
    `${config.ocultarServidor ? DESLIGADO : LIGADO} **Nome do servidor** nas mensagens`,
    `${config.ocultarPerfil ? DESLIGADO : LIGADO} **Link do perfil** nas mensagens`,
    `-# Use ${PREFIXO}config servidor mostrar|ocultar e ${PREFIXO}config perfil mostrar|ocultar.`,
    `-# Altere os filtros com \`${PREFIXO}automod\` e pause com \`${PREFIXO}pausar\`.`
  ].filter((linha) => linha !== null).join('\n');
}

module.exports = {
  name: 'config',
  aliases: ['configurar', 'configurações'],
  description: 'Mostra o estado da conexão global e do webhook.',

  async execute(message, args = []) {
    const guildId = idDoServidor(message);
    if (!guildId) return;

    const campo = { servidor: 'ocultarServidor', perfil: 'ocultarPerfil' }[(args[0] || '').toLowerCase()];
    const acao = (args[1] || '').toLowerCase();
    const ocultar = ['ocultar', 'esconder', 'off'].includes(acao) ? true : ['mostrar', 'exibir', 'on'].includes(acao) ? false : null;

    if (!(await temPermissaoConfig(message))) {
      log.warn('CONFIG', `Permissão negada para ${descreverContexto(message)}`);
      await message.reply('<:closecirclefill:1562606683371339786> Você precisa da permissão **Gerenciar Canais** (ou ser o desenvolvedor do Global) para usar este comando.');
      return;
    }

    if (campo && ocultar !== null) {
      await Guild.findOneAndUpdate({ guildId: String(guildId) }, { [campo]: ocultar }, { upsert: true, setDefaultsOnInsert: true });
      log.ok('CONFIG', `${campo} = ${ocultar} | ${descreverContexto(message)}`);
      await message.reply(`<:checkboxcirclefill:1562606683371339777> ${campo === 'ocultarServidor' ? 'Nome do servidor' : 'Link do perfil'} ${ocultar ? 'oculto' : 'visível'} nas mensagens enviadas daqui.`);
      return;
    }

    const config = await Guild.findOne({ guildId: String(guildId) }).lean();
    await message.reply(montarStatus(config || {}));
  }
};
