require('dotenv').config();
console.log('Tamanho do TOKEN:72', process.env.TOKEN?.length);
console.log('Primeiro/último char (código):', process.env.TOKEN?.charCodeAt(0), process.env.TOKEN?.charCodeAt(process.env.TOKEN.length - 1));
const fs = require('fs');
const path = require('path');

const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    EmbedBuilder,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ComponentType,
    SlashCommandBuilder,
    REST,
    Routes,
    Collection
} = require('discord.js');

const {
    joinVoiceChannel,
    createAudioPlayer,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState
} = require('@discordjs/voice');

const { buscarInfoMusica, criarRecursoAudio } = require('./musica.js');
const { buscarFaixas: buscarFaixasSpotify, ehPlaylistOuAlbum: ehPlaylistOuAlbumSpotify } = require('./spotify.js');
const fatosCuriosos = require('./fatos.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages // necessário pra receber mensagens em DM
    ],
    partials: [Partials.Channel] // sem isso o discord.js não dispara messageCreate em DM
});

// Rede de segurança: se algum erro escapar do try/catch dos comandos
// (ex: uma promise sem await que rejeita), isso evita que o bot inteiro crashe.
process.on('unhandledRejection', (erro) => {
    console.error('Erro não tratado (unhandledRejection):', erro);
});

process.on('uncaughtException', (erro) => {
    console.error('Erro não tratado (uncaughtException):', erro);
});

client.on('error', (erro) => {
    console.error('Erro do client Discord:', erro);
});

// Contas com menos de 7 dias de criação não podem participar do servidor
const IDADE_MINIMA_CONTA_MS = 7 * 24 * 60 * 60 * 1000;

client.on('guildMemberAdd', async (member) => {
    try {
        if (member.user.bot) return;

        const idadeConta = Date.now() - member.user.createdTimestamp;

        if (idadeConta < IDADE_MINIMA_CONTA_MS) {
            const diasFaltando = Math.ceil((IDADE_MINIMA_CONTA_MS - idadeConta) / (24 * 60 * 60 * 1000));

            await member.send(
                `🚫 Contas com menos de 7 dias de criação não podem participar do servidor.\n` +
                `Caso sua conta seja muito recente, aguarde até completar 7 dias para entrar.\n` +
                `Faltam aproximadamente ${diasFaltando} dia(s) para você poder entrar em **${member.guild.name}**.`
            ).catch(() => {}); // se a DM estiver fechada, ignora e segue com a remoção

            await member.kick('Conta com menos de 7 dias de criação').catch((erro) => {
                console.error('Erro ao remover conta recente do servidor:', erro);
            });
        }
    } catch (erro) {
        console.error('Erro ao checar idade da conta no guildMemberAdd:', erro);
    }
});

client.once('clientReady', () => {
    console.log(`🤖 ${client.user.tag} está online!`);

    // Confere a cada 30s se alguma cápsula do tempo já pode abrir
    setInterval(async () => {
        const agora = Date.now();

        for (let i = capsulasPendentes.length - 1; i >= 0; i--) {
            const capsula = capsulasPendentes[i];

            if (agora >= capsula.desbloqueiaEm) {
                try {
                    const canal = await client.channels.fetch(capsula.canalId);
                    const embed = new EmbedBuilder()
                        .setTitle('📦 Uma cápsula do tempo se abriu!')
                        .setDescription(capsula.texto)
                        .setFooter({ text: `Escrita por ${capsula.autorTag}` })
                        .setColor(0xEB459E);

                    await canal.send({ embeds: [embed] });
                } catch (erro) {
                    console.error('Erro ao abrir cápsula do tempo:', erro);
                }

                capsulasPendentes.splice(i, 1);
                salvarDados();
            }
        }

        // Confere as sessões agendadas (p!sessão) e dispara as chamadas 1/3, 2/3 e 3/3
        for (const [guildId, sessao] of sessoesAtivas) {
            try {
                if (!sessao.enviouChamada1 && agora >= sessao.chamada1Em) {
                    sessao.enviouChamada1 = true;
                    sessao.janelaAberta = true;
                    sessao.presentes = [];

                    const canal = await client.channels.fetch(sessao.canalId);
                    await canal.send({
                        content: `@everyone\n**1/3** — diga **Eu** pra marcar presença.`,
                        allowedMentions: { parse: ['everyone'] }
                    });

                    salvarDados();
                }

                if (!sessao.enviouChamada2 && agora >= sessao.chamada2Em) {
                    sessao.enviouChamada2 = true;

                    const canal = await client.channels.fetch(sessao.canalId);
                    await canal.send({
                        content: `@everyone\n**2/3** — diga **Eu** pra marcar presença.`,
                        allowedMentions: { parse: ['everyone'] }
                    });

                    salvarDados();
                }

                if (!sessao.enviouChamada3 && agora >= sessao.alvoMs) {
                    sessao.enviouChamada3 = true;
                    sessao.janelaAberta = false; // para de contar "Eu" a partir daqui

                    const canal = await client.channels.fetch(sessao.canalId);
                    await canal.send({
                        content: `@everyone\n**3/3** — todos vão pro seus quartos com o roteiro escrito.`,
                        allowedMentions: { parse: ['everyone'] }
                    });

                    await processarFimSessao(sessao);

                    sessoesAtivas.delete(guildId);
                    salvarDados();
                }
            } catch (erro) {
                console.error('Erro ao processar sessão agendada:', erro);
                sessoesAtivas.delete(guildId);
                salvarDados();
            }
        }
    }, 30000);
});

// ---------- Helpers ----------

function pegarAlvo(message) {
    const mencionado = message.mentions.users.first();
    return mencionado || message.author;
}

// Gera sempre o mesmo número para o mesmo par (dia + IDs), assim o resultado
// não muda a cada chamada no mesmo dia — mais engraçado tipo "ship" de verdade.
function seedNumero(seedStr, min, max) {
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
        hash = (hash << 5) - hash + seedStr.charCodeAt(i);
        hash |= 0;
    }
    const normalizado = Math.abs(hash) % (max - min + 1);
    return min + normalizado;
}

function hojeStr() {
    return new Date().toISOString().slice(0, 10);
}

function temPermissao(message, flag) {
    return Boolean(message.guild && message.member && message.member.permissions.has(flag));
}

const NUMEROS_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// ---------- Economia (Miracoins) ----------
// IDs dos donos do bot, configurados via .env (OWNER_IDS=id1,id2,id3).
// Só quem estiver nessa lista pode usar os comandos administrativos da economia.
const OWNER_IDS = (process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

function ehDono(message) {
    return OWNER_IDS.includes(message.author.id);
}

// Converte durações tipo "30s", "10m", "2h", "1d" em milissegundos. Retorna null se inválido.
function parseDuracaoMs(str) {
    const match = (str || '').trim().match(/^(\d+)\s*(s|m|h|d)$/i);
    if (!match) return null;

    const multiplicadores = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return parseInt(match[1], 10) * multiplicadores[match[2].toLowerCase()];
}

// Taxa da casa: percentual cobrado em cima do LUCRO (não da aposta inteira)
// em qualquer jogo de azar. Esse valor é debitado da conta do jogador (depois
// de ele já ter recebido o prêmio cheio) e vai direto pro imposto arrecadado.
const TAXA_CASA = 0.30;

const CUSTO_CASAMENTO = 25000;
const GIF_CASAMENTO = 'https://klipy.com/gifs/spy-x-family-loid-forger-16';

// XP necessário por nível — pode ajustar pra deixar mais fácil/difícil de subir
const XP_POR_NIVEL = 5000;

// Empréstimo: prazo de 2 dias sem juros, depois disso os juros começam a
// compor a cada período de 2 dias que passar sem pagar.
const PRAZO_EMPRESTIMO_MS = 2 * 24 * 60 * 60 * 1000;
const JUROS_EMPRESTIMO = 0.20; // 20% por período de 2 dias em atraso

// Diário: 250 de base, dobra a cada 5 dias seguidos de sequência
const DIARIO_BASE = 250;
const DIARIO_INTERVALO_MS = 24 * 60 * 60 * 1000;
const DIARIO_TOLERANCIA_MS = 48 * 60 * 60 * 1000; // até 48h pra manter a sequência

// ---------- Loja ----------
// Preços pensados considerando que a maioria dos membros tem uns 1000 de
// saldo mínimo e que o casamento (item mais caro que já existia) custa 25k.
const PRECO_VIP = 15000;    // cargo VIP com nome e cor escolhidos pelo próprio membro
const PRECO_EMOJI = 20000;  // emoji personalizado adicionado ao servidor
const PRECO_ANEL = 35000;   // anel de noivado — funde a conta com a do cônjuge

// Títulos: aparecem do lado do apelido da pessoa no servidor, tipo "Nome [Título]".
// Não mexem no apelido antigo, só adicionam o sufixo.
const TITULOS = [
    { id: 'heroi_historia', nome: 'O Herói mais forte da história', preco: 22000 },
    { id: 'heroi_atualidade', nome: 'O Herói mais forte da atualidade', preco: 18000 },
    { id: 'ameaca_paris', nome: 'Ameaça de Paris', preco: 15000 },
    { id: 'protetor_paris', nome: 'Protetor de Paris', preco: 15000 },
    { id: 'vilao_historia', nome: 'O Vilão mais forte da história', preco: 22000 },
    { id: 'vilao_atualidade', nome: 'O Vilão mais forte da atualidade', preco: 18000 },
    { id: 'lenda_paris', nome: 'Lenda de Paris', preco: 25000 }
];

// Trabalho: renda pequena e frequente, sem risco.
const TRABALHO_COOLDOWN_MS = 60 * 60 * 1000; // 1h
const TRABALHO_MIN = 100;
const TRABALHO_MAX = 400;

// Crime: renda maior, mas 60% de chance de dar errado e a pessoa ficar devendo.
const CRIME_COOLDOWN_MS = 45 * 60 * 1000; // 45min
const CRIME_CHANCE_SUCESSO = 0.40; // 40% de chance de dar certo
const CRIME_GANHO_MIN = 500;
const CRIME_GANHO_MAX = 1500;
const CRIME_MULTA_MIN = 400;
const CRIME_MULTA_MAX = 1800;

// Miraculous: preços "salgados" mas nenhum passa de 25k. Cada um dá acesso a
// um comando de poder próprio (ver seção "Poderes dos Miraculous").
const MIRACULOUS = [
    { id: 'joaninha', emoji: '🐞', nome: 'Miraculous da Joaninha', poder: 'Talismã', comando: 'p!talismã @pessoa', descricao: 'Prende (muta) o alvo por 20 segundos.', preco: 25000 },
    { id: 'gato', emoji: '🐈‍⬛', nome: 'Miraculous do Gato', poder: 'Cataclismo', comando: 'p!cataclismo (respondendo a uma mensagem)', descricao: 'Apaga a mensagem que você está respondendo.', preco: 24000 },
    { id: 'pavao', emoji: '🦚', nome: 'Miraculous do Pavão', poder: 'Sentimonstro', comando: 'p!sentimonstro', descricao: 'Cria um aliado temporário que absorve o próximo ataque no seu lugar.', preco: 21000 },
    { id: 'raposa', emoji: '🦊', nome: 'Miraculous da Raposa', poder: 'Miragem', comando: 'p!miragem', descricao: 'Cria uma ilusão: por um tempo, seus comandos mostram um alvo falso.', preco: 19000 },
    { id: 'abelha', emoji: '🐝', nome: 'Miraculous da Abelha', poder: 'Ferroada', comando: 'p!ferroada @pessoa', descricao: 'Veneno: paralisa (muta) o alvo por 20 segundos.', preco: 18000 },
    { id: 'tartaruga', emoji: '🐢', nome: 'Miraculous da Tartaruga', poder: 'Casco-Protetor', comando: 'p!proteção', descricao: 'Fica imune aos próximos 2 ataques.', preco: 20000 },
    { id: 'cavalo', emoji: '🐴', nome: 'Miraculous do Cavalo', poder: 'Viagem', comando: 'p!viajar', descricao: 'Abre um portal: troca de posição com alguém aleatório do chat pra receber o próximo ataque no seu lugar.', preco: 17000 },
    { id: 'cobra', emoji: '🐍', nome: 'Miraculous da Cobra', poder: 'Segunda Chance', comando: 'p!segunda-chance', descricao: 'Se sofrer um efeito negativo nos próximos 30 segundos, ele é cancelado.', preco: 21000 },
    { id: 'boi', emoji: '🐂', nome: 'Miraculous do Boi (Stompp)', poder: 'Resistência', comando: 'p!resistencia', descricao: 'Fica imune a magia: não pode ser afetado por 1 golpe.', preco: 16000 },
    { id: 'cachorro', emoji: '🐶', nome: 'Miraculous do Cachorro', poder: 'Busca', comando: 'p!pega! @pessoa', descricao: 'Usa seu faro e muta o alvo por 20 segundos.', preco: 15000 },
    { id: 'tigre', emoji: '🐯', nome: 'Miraculous do Tigre (Roarr)', poder: 'Golpe Poderoso', comando: 'p!colisão', descricao: 'Desfere um golpe devastador: apaga as últimas 8 mensagens do canal.', preco: 23000 },
    { id: 'aguia', emoji: '🦅', nome: 'Miraculous da Águia (Liiri)', poder: 'Liberdade', comando: 'p!libertar @pessoa', descricao: 'Remove mutes e efeitos de controle do alvo.', preco: 19000 },
    { id: 'cabra', emoji: '🐐', nome: 'Miraculous da Cabra', poder: 'Gênese', comando: 'p!genesis', descricao: 'Faz chover Miracoins: as últimas 5 pessoas que falaram no canal ganham 250 Miracoins cada.', preco: 25000 }
];

function pegarMiraculous(id) {
    return MIRACULOUS.find(m => m.id === id);
}

function pegarTitulo(id) {
    return TITULOS.find(t => t.id === id);
}

// ---------- Estrutura da loja: categorias + páginas ----------
// Limitado a 3 pra caber os botões de compra: o Discord permite no máximo 5
// fileiras de componentes por mensagem (3 botões de item + seletor + navegação = 5).
const ITENS_POR_PAGINA_LOJA = 3;

const LOJA_CATEGORIAS = [
    {
        id: 'cargos',
        nome: '👑 Cargos & Cosméticos',
        descricao: 'Cargo VIP, emoji personalizado e títulos que aparecem do lado do seu nick.',
        itens: [
            { emoji: '👑', nome: 'Cargo VIP', preco: PRECO_VIP, descricao: 'Cargo com nome e cor escolhidos por você (sobe pro topo do servidor).', comando: 'p!comprar vip Nome do Cargo | #FF00AA' },
            { emoji: '😎', nome: 'Emoji personalizado', preco: PRECO_EMOJI, descricao: 'Adiciona um emoji seu ao servidor (anexe uma imagem na mensagem).', comando: 'p!comprar emoji nome_do_emoji' },
            ...TITULOS.map(t => ({ emoji: '🏷️', nome: `Título: ${t.nome}`, preco: t.preco, descricao: 'Aparece do lado do seu apelido: "Nome [Título]".', comando: `p!comprar titulo ${t.id}`, compraDireta: true, tipo: 'titulo', idItem: t.id }))
        ]
    },
    {
        id: 'casamento',
        nome: '💍 Casamento',
        descricao: 'Itens ligados ao casamento (`p!casar`).',
        itens: [
            { emoji: '💍', nome: 'Anel de noivado', preco: PRECO_ANEL, descricao: 'Funde sua carteira e banco com os do seu cônjuge.', comando: 'p!comprar anel', compraDireta: true, tipo: 'anel', idItem: null }
        ]
    },
    {
        id: 'miraculous',
        nome: '🐞 Miraculous',
        descricao: 'Cada Miraculous dá acesso a um poder único de combate.',
        itens: MIRACULOUS.map(m => ({ emoji: m.emoji, nome: `${m.nome} (${m.poder})`, preco: m.preco, descricao: m.descricao, comando: `p!comprar miraculous ${m.id}`, compraDireta: true, tipo: 'miraculous', idItem: m.id }))
    }
];

// Embed único da página: um field por item (nome + preço no título do field,
// descrição no corpo) — igual a uma "carta" de loja com vários itens dentro.
function construirEmbedLoja(categoriaIndex, pagina) {
    const categoria = LOJA_CATEGORIAS[categoriaIndex];
    const totalPaginas = Math.max(1, Math.ceil(categoria.itens.length / ITENS_POR_PAGINA_LOJA));
    pagina = Math.min(Math.max(pagina, 0), totalPaginas - 1);

    const inicio = pagina * ITENS_POR_PAGINA_LOJA;
    const fatia = categoria.itens.slice(inicio, inicio + ITENS_POR_PAGINA_LOJA);

    const embed = new EmbedBuilder()
        .setTitle(`🛒 Loja do servidor — ${categoria.nome}`)
        .setColor(0x8A2BE2)
        .setDescription(`${categoria.descricao}\n\nUse os botões abaixo pra comprar na hora, ou \`p!comprar <item>\`.`)
        .addFields(
            fatia.map(item => ({
                name: `${item.emoji} ${item.nome} — ${formatarMoeda(item.preco)}`,
                value: item.descricao
            }))
        )
        .setFooter({ text: `Página ${pagina + 1}/${totalPaginas} — Categoria ${categoriaIndex + 1}/${LOJA_CATEGORIAS.length}` });

    return { embed, pagina, totalPaginas, fatia, inicio };
}

function construirComponentesLoja(categoriaIndex, pagina, totalPaginas, fatia, inicio) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('loja_categoria')
        .setPlaceholder('Escolha uma categoria')
        .addOptions(
            LOJA_CATEGORIAS.map((cat, i) => ({
                label: cat.nome,
                value: String(i),
                default: i === categoriaIndex
            }))
        );

    const botoesNavegacao = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('loja_anterior').setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(pagina <= 0),
        new ButtonBuilder().setCustomId('loja_proximo').setLabel('Próxima ▶').setStyle(ButtonStyle.Secondary).setDisabled(pagina >= totalPaginas - 1)
    );

    // Um botão por item, na mesma ordem dos fields do embed — fica logo abaixo
    // do embed, na mesma sequência visual dos itens listados.
    const botoesItens = fatia.map((item, i) => {
        const indiceGlobal = inicio + i;

        if (item.compraDireta) {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`loja_comprar_${categoriaIndex}_${indiceGlobal}`)
                    .setLabel(`${item.nome} — ${Math.round(item.preco).toLocaleString('pt-BR')}`.slice(0, 80))
                    .setEmoji('✨')
                    .setStyle(ButtonStyle.Success)
            );
        }

        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`loja_vercomando_${categoriaIndex}_${indiceGlobal}`)
                .setLabel(`Ver comando: ${item.nome}`.slice(0, 80))
                .setStyle(ButtonStyle.Secondary)
        );
    });

    return [...botoesItens, new ActionRowBuilder().addComponents(selectMenu), botoesNavegacao];
}

// ---------- Compra direta de itens da loja (usada pelo p!comprar e pelos botões verdes) ----------
// `ctx` padroniza a resposta pra funcionar tanto com mensagem normal (p!comprar)
// quanto com clique de botão (interação): { autorId, autorUsername, responderErro, enviarPublico }

async function executarCompraAnel(ctx) {
    const contaAutor = pegarConta(ctx.autorId);

    if (!contaAutor.casadoCom) {
        return ctx.responderErro('❌ Você precisa estar casado(a) (`p!casar`) pra comprar o anel de noivado.');
    }

    if (contaAutor.contaConjuntaCom) {
        return ctx.responderErro('❌ Você já tem o anel de noivado com seu cônjuge.');
    }

    if (contaAutor.carteira < PRECO_ANEL) {
        return ctx.responderErro(`❌ O anel de noivado custa ${formatarMoeda(PRECO_ANEL)} e você não tem esse valor. Carteira: ${formatarMoeda(contaAutor.carteira)}`);
    }

    const conjugeId = contaAutor.casadoCom;
    const contaConjuge = pegarConta(conjugeId);

    if (contaConjuge.contaConjuntaCom) {
        return ctx.responderErro('❌ Seu cônjuge já está com a conta unida a outra pessoa. Isso não devia acontecer — chama um dono do bot.');
    }

    contaAutor.carteira -= PRECO_ANEL;

    const chave = chaveCasal(ctx.autorId, conjugeId);
    contasConjuntas[chave] = {
        carteira: contaAutor.carteira + contaConjuge.carteira,
        banco: contaAutor.banco + contaConjuge.banco
    };

    contaAutor.contaConjuntaCom = conjugeId;
    contaConjuge.contaConjuntaCom = ctx.autorId;
    salvarDados();

    let nomeConjuge = 'seu cônjuge';
    try {
        const usuario = await client.users.fetch(conjugeId);
        nomeConjuge = usuario.username;
    } catch (_) {}

    return ctx.enviarPublico(
        `💍 **${ctx.autorUsername}** comprou o anel de noivado! A conta dele(a) agora está unida com a de **${nomeConjuge}** — ` +
        `carteira e banco são compartilhados entre os dois a partir de agora. (Use \`p!divorciar\` pra desfazer.)`
    );
}

async function executarCompraTitulo(ctx, idTitulo) {
    const titulo = pegarTitulo(idTitulo);

    if (!titulo) {
        return ctx.responderErro(
            'Use: p!comprar titulo <id>\nTítulos disponíveis:\n' +
            TITULOS.map(t => `\`${t.id}\` — ${t.nome} (${formatarMoeda(t.preco)})`).join('\n')
        );
    }

    const conta = pegarConta(ctx.autorId);

    if (conta.titulosComprados.includes(titulo.id)) {
        return ctx.responderErro(`❌ Você já comprou o título **${titulo.nome}**. Use \`p!titulo ${titulo.id}\` pra equipar.`);
    }

    if (conta.carteira < titulo.preco) {
        return ctx.responderErro(`❌ O título **${titulo.nome}** custa ${formatarMoeda(titulo.preco)} e você não tem esse valor. Carteira: ${formatarMoeda(conta.carteira)}`);
    }

    conta.carteira -= titulo.preco;
    conta.titulosComprados.push(titulo.id);
    salvarDados();

    return ctx.enviarPublico(
        `🏷️ **${ctx.autorUsername}** comprou o título **${titulo.nome}**!\n` +
        `Use \`p!titulo ${titulo.id}\` pra equipar (ou \`p!titulo remover\` pra tirar).`
    );
}

async function executarCompraMiraculous(ctx, idMiraculous) {
    const miraculous = pegarMiraculous(idMiraculous);

    if (!miraculous) {
        return ctx.responderErro(
            'Use: p!comprar miraculous <id>\nMiraculous disponíveis:\n' +
            MIRACULOUS.map(m => `\`${m.id}\` — ${m.emoji} ${m.nome} (${formatarMoeda(m.preco)})`).join('\n')
        );
    }

    const conta = pegarConta(ctx.autorId);

    if (conta.miraculousComprados.includes(miraculous.id)) {
        return ctx.responderErro(`❌ Você já tem o **${miraculous.nome}**.`);
    }

    if (conta.carteira < miraculous.preco) {
        return ctx.responderErro(`❌ O **${miraculous.nome}** custa ${formatarMoeda(miraculous.preco)} e você não tem esse valor. Carteira: ${formatarMoeda(conta.carteira)}`);
    }

    conta.carteira -= miraculous.preco;
    conta.miraculousComprados.push(miraculous.id);
    salvarDados();

    return ctx.enviarPublico(
        `${miraculous.emoji} **${ctx.autorUsername}** recebeu o **${miraculous.nome}**!\n` +
        `Poder: **${miraculous.poder}** — ${miraculous.descricao}\n` +
        `Use: \`${miraculous.comando}\``
    );
}

// Roteia pro executor certo a partir do item da loja (usado pelos botões verdes).
async function executarCompraDireta(ctx, item) {
    if (item.tipo === 'anel') return executarCompraAnel(ctx);
    if (item.tipo === 'titulo') return executarCompraTitulo(ctx, item.idItem);
    if (item.tipo === 'miraculous') return executarCompraMiraculous(ctx, item.idItem);
    return ctx.responderErro('❌ Esse item não pode ser comprado direto pelo botão.');
}

// Remove acentos pra facilitar bater comandos com/sem acento (talismã/talisma, proteção/protecao...)
function semAcento(texto) {
    return (texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Confere se a PRIMEIRA PALAVRA da mensagem é exatamente um dos comandos (ignorando
// acento e maiúscula/minúscula). Usa igualdade da primeira palavra, não startsWith,
// pra não colidir com comandos parecidos (ex: p!pega vs p!pegarimposto).
function comandoBate(conteudo, ...comandos) {
    const primeiraPalavra = semAcento((conteudo || '').trim().split(/\s+/)[0] || '').toLowerCase();
    return comandos.some(cmd => primeiraPalavra === semAcento(cmd.toLowerCase()));
}

// Canal onde os poderes dos Miraculous podem ser usados. Donos do bot não têm essa restrição.
const CANAL_PODERES_MIRACULOUS = '1524910258856923148';

// Lista de comandos de poder (primeira palavra), usada pra restringir onde podem ser usados.
const COMANDOS_PODERES_MIRACULOUS = [
    'p!talisma', 'p!cataclismo', 'p!sentimonstro', 'p!miragem', 'p!ferroada',
    'p!protecao', 'p!viajar', 'p!segunda-chance', 'p!segundachance', 'p!resistencia',
    'p!pega', 'p!pega!', 'p!colisao', 'p!libertar', 'p!genesis'
];

function ehComandoDePoder(conteudo) {
    return comandoBate(conteudo, ...COMANDOS_PODERES_MIRACULOUS);
}

// ---------- Poderes dos Miraculous: proteções de combate ----------
// Confere, na ordem certa, se o alvo tem alguma proteção ativa. Se tiver,
// consome a proteção (gasta 1 uso / cancela) e retorna o motivo. Quem estiver
// chamando isso deve CANCELAR o efeito negativo se "protegido" vier true.
function verificarProtecao(contaAlvo) {
    const agora = Date.now();

    // Casco-Protetor (Tartaruga) — absorve os próximos 2 ataques
    if (contaAlvo.escudoTartaruga > 0) {
        contaAlvo.escudoTartaruga -= 1;
        return { protegido: true, motivo: '🐢 O Casco-Protetor absorveu o ataque!' };
    }

    // Resistência (Boi) — imune a 1 golpe
    if (contaAlvo.resistenciaBoi) {
        contaAlvo.resistenciaBoi = false;
        return { protegido: true, motivo: '🐂 A Resistência bloqueou o golpe!' };
    }

    // Segunda Chance (Cobra) — cancela efeito negativo dentro da janela de 30s
    if (contaAlvo.segundaChanceAte && agora <= contaAlvo.segundaChanceAte) {
        contaAlvo.segundaChanceAte = 0;
        return { protegido: true, motivo: '🐍 A Segunda Chance cancelou o efeito!' };
    }

    return { protegido: false, motivo: null };
}

// Se o alvo tiver usado "Viagem" (Cavalo) recentemente, redireciona o ataque
// pra quem foi sorteado no lugar dele. Retorna o id final que deve receber o
// ataque (pode ser o mesmo id, se não houver redirecionamento ativo).
function resolverRedirecionamento(idAlvoOriginal) {
    const contaAlvo = pegarConta(idAlvoOriginal);
    const agora = Date.now();

    if (contaAlvo.redirecionarAtaquePara && agora <= contaAlvo.redirecionarAte) {
        const idFinal = contaAlvo.redirecionarAtaquePara;
        contaAlvo.redirecionarAtaquePara = null;
        contaAlvo.redirecionarAte = 0;
        return idFinal;
    }

    return idAlvoOriginal;
}

// Aplica um "ataque" de mute (timeout) considerando proteções e redirecionamento.
// Retorna uma string pronta pra usar na resposta do comando.
async function aplicarAtaqueMute(message, alvo, ms, fraseAcao) {
    const idFinal = resolverRedirecionamento(alvo.id);
    const contaFinal = pegarConta(idFinal);

    const { protegido, motivo } = verificarProtecao(contaFinal);
    salvarDados();

    if (protegido) {
        return `${fraseAcao}\n${motivo}`;
    }

    if (!message.guild) return `${fraseAcao}\n(Fora de um servidor não dá pra aplicar o mute de verdade.)`;

    const membroFinal = await message.guild.members.fetch(idFinal).catch(() => null);
    if (!membroFinal) return `${fraseAcao}\n❌ Não encontrei o alvo no servidor pra aplicar o efeito.`;
    if (!membroFinal.moderatable) return `${fraseAcao}\n❌ Não consigo mutar essa pessoa (cargo dela é igual ou maior que o meu).`;

    await membroFinal.timeout(ms, 'Poder de Miraculous').catch(() => {});

    const aviso = idFinal !== alvo.id ? `\n🐴 (Redirecionado pra **${membroFinal.user.username}** pela Viagem!)` : '';
    return `${fraseAcao}${aviso}`;
}

// Garante que a pessoa tem o miraculous necessário pra usar o poder.
function temMiraculous(conta, id) {
    return conta.miraculousComprados.includes(id);
}

// ---------- Cooldown dos poderes dos Miraculous ----------
// Poderes mais fortes/destrutivos têm cooldown maior. Máximo: 1 hora.
// Donos do bot (OWNER_IDS) não têm cooldown em nenhum poder.
const COOLDOWN_PODERES_MS = {
    joaninha: 5 * 60 * 1000,   // Talismã (mute 20s) — 5 min
    abelha: 5 * 60 * 1000,     // Ferroada (mute 20s) — 5 min
    cachorro: 5 * 60 * 1000,   // Busca (mute 20s) — 5 min
    pavao: 10 * 60 * 1000,     // Sentimonstro (escudo) — 10 min
    cobra: 10 * 60 * 1000,     // Segunda Chance — 10 min
    aguia: 10 * 60 * 1000,     // Libertar — 10 min
    cavalo: 15 * 60 * 1000,    // Viagem (redireciona ataque) — 15 min
    raposa: 15 * 60 * 1000,    // Miragem (ilusão) — 15 min
    gato: 15 * 60 * 1000,      // Cataclismo (apaga 1 mensagem) — 15 min
    tartaruga: 20 * 60 * 1000, // Casco-Protetor (imune a 2 ataques) — 20 min
    boi: 20 * 60 * 1000,       // Resistência (imune a 1 golpe) — 20 min
    tigre: 45 * 60 * 1000,     // Colisão (apaga 8 mensagens do canal) — 45 min
    cabra: 60 * 60 * 1000      // Gênese (dá Miracoins pra 5 pessoas) — 1h (máximo)
};

// Formata um tempo em ms como "Xmin Ys" ou "Ys" pra mostrar nas mensagens.
function formatarTempoRestante(ms) {
    const totalSegundos = Math.max(1, Math.ceil(ms / 1000));
    const minutos = Math.floor(totalSegundos / 60);
    const segundos = totalSegundos % 60;
    if (minutos > 0) return `${minutos}min${segundos > 0 ? ` ${segundos}s` : ''}`;
    return `${segundos}s`;
}

// Retorna quanto tempo (em ms) ainda falta de cooldown pro poder `id`.
// Donos do bot nunca têm cooldown (retorna sempre 0).
function pegarCooldownRestante(message, conta, id) {
    if (ehDono(message)) return 0;

    const cooldownMs = COOLDOWN_PODERES_MS[id] || 0;
    if (cooldownMs === 0) return 0;

    if (!conta.cooldownsPoderes) conta.cooldownsPoderes = {};

    const ultimoUso = conta.cooldownsPoderes[id] || 0;
    const passou = Date.now() - ultimoUso;

    return passou < cooldownMs ? cooldownMs - passou : 0;
}

// Marca o poder `id` como usado agora (inicia o cooldown dele).
function registrarUsoPoder(conta, id) {
    if (!conta.cooldownsPoderes) conta.cooldownsPoderes = {};
    conta.cooldownsPoderes[id] = Date.now();
}

// Reaplica o apelido com o título ativo no final, sem alterar o "nome base"
// guardado da primeira vez que a pessoa equipou um título.
async function aplicarTituloNoApelido(message, conta) {
    if (!message.guild) return;

    const membro = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!membro) return;
    if (!membro.manageable) return; // não consigo mudar apelido de quem tem cargo igual/maior

    if (!conta.apelidoBase) {
        conta.apelidoBase = membro.nickname || membro.user.username;
    }

    try {
        if (conta.tituloAtivo) {
            const titulo = pegarTitulo(conta.tituloAtivo);
            const novoApelido = `${conta.apelidoBase} [${titulo ? titulo.nome : conta.tituloAtivo}]`.slice(0, 32);
            await membro.setNickname(novoApelido, 'Título da loja equipado');
        } else {
            await membro.setNickname(conta.apelidoBase, 'Título da loja removido');
        }
    } catch (erro) {
        console.error('Erro ao aplicar título no apelido:', erro);
    }
}

function chaveCasal(id1, id2) {
    return [id1, id2].sort().join('_');
}

function pegarConta(userId) {
    if (!economia[userId]) {
        economia[userId] = {
            carteira: 0,
            banco: 0,
            nivel: 1,
            xp: 0,
            casadoCom: null,
            emprestimo: null, // { valor, dataPegou }
            diarioStreak: 0,
            diarioUltimo: 0,
            cargoVipId: null,        // id do cargo VIP personalizado (loja)
            contaConjuntaCom: null,  // id do cônjuge, se comprou o anel de noivado
            titulosComprados: [],    // ids dos títulos comprados na loja
            tituloAtivo: null,       // id do título ativo (aparece do lado do nick)
            apelidoBase: null,       // apelido "original" salvo pra poder reaplicar o título sem sujar o nick
            miraculousComprados: [], // ids dos miraculous comprados
            ultimoTrabalho: 0,       // timestamp do último p!trabalhar
            ultimoCrime: 0,          // timestamp do último p!crime
            escudoTartaruga: 0,      // quantos ataques ainda absorve (Casco-Protetor da Tartaruga e Sentimonstro do Pavão usam o mesmo contador)
            resistenciaBoi: false,   // imune a 1 próximo ataque
            segundaChanceAte: 0,     // timestamp até quando o próximo efeito negativo é cancelado
            redirecionarAtaquePara: null, // id de quem recebe o próximo ataque no lugar dela (Viagem)
            redirecionarAte: 0,
            ilusaoAte: 0,            // até quando os comandos mostram um alvo falso (Miragem)
            cooldownsPoderes: {}     // { idDoMiraculous: timestamp do último uso } — cooldown dos poderes
        };
    }
    // garante que contas antigas (criadas antes dessas mudanças) tenham os campos novos
    const conta = economia[userId];
    if (conta.xp === undefined) conta.xp = 0;
    if (conta.emprestimo === undefined) conta.emprestimo = null;
    if (conta.diarioStreak === undefined) conta.diarioStreak = 0;
    if (conta.diarioUltimo === undefined) conta.diarioUltimo = 0;
    if (conta.cargoVipId === undefined) conta.cargoVipId = null;
    if (conta.contaConjuntaCom === undefined) conta.contaConjuntaCom = null;
    if (conta.titulosComprados === undefined) conta.titulosComprados = [];
    if (conta.tituloAtivo === undefined) conta.tituloAtivo = null;
    if (conta.apelidoBase === undefined) conta.apelidoBase = null;
    if (conta.miraculousComprados === undefined) conta.miraculousComprados = [];
    if (conta.ultimoTrabalho === undefined) conta.ultimoTrabalho = 0;
    if (conta.ultimoCrime === undefined) conta.ultimoCrime = 0;
    if (conta.escudoTartaruga === undefined) conta.escudoTartaruga = 0;
    if (conta.resistenciaBoi === undefined) conta.resistenciaBoi = false;
    if (conta.segundaChanceAte === undefined) conta.segundaChanceAte = 0;
    if (conta.redirecionarAtaquePara === undefined) conta.redirecionarAtaquePara = null;
    if (conta.redirecionarAte === undefined) conta.redirecionarAte = 0;
    if (conta.ilusaoAte === undefined) conta.ilusaoAte = 0;
    if (conta.cooldownsPoderes === undefined) conta.cooldownsPoderes = {};

    // Se a pessoa comprou o anel de noivado, carteira/banco passam a apontar
    // pra um "cofre" compartilhado com o cônjuge, mas o resto (nível, xp,
    // streak do diário etc) continua sendo individual.
    if (conta.contaConjuntaCom) {
        const chave = chaveCasal(userId, conta.contaConjuntaCom);
        if (!contasConjuntas[chave]) {
            contasConjuntas[chave] = { carteira: conta.carteira, banco: conta.banco };
        }
        const compartilhada = contasConjuntas[chave];

        return new Proxy(conta, {
            get(alvo, prop) {
                if (prop === 'carteira' || prop === 'banco') return compartilhada[prop];
                return alvo[prop];
            },
            set(alvo, prop, valor) {
                if (prop === 'carteira' || prop === 'banco') {
                    compartilhada[prop] = valor;
                } else {
                    alvo[prop] = valor;
                }
                return true;
            }
        });
    }

    return conta;
}

function formatarMoeda(valor) {
    return `✨ ${Math.round(valor).toLocaleString('pt-BR')} Miracoins`;
}

// Calcula o nível a partir do XP acumulado
function calcularNivel(xp) {
    return 1 + Math.floor(xp / XP_POR_NIVEL);
}

// Dá XP baseado em quanto a pessoa apostou/ganhou. Retorna true se subiu de nível.
function ganharXp(conta, quantidade) {
    if (quantidade <= 0) return false;
    conta.xp += Math.round(quantidade);
    const novoNivel = calcularNivel(conta.xp);
    const subiu = novoNivel > conta.nivel;
    conta.nivel = novoNivel;
    return subiu;
}

// Resolve o resultado de uma aposta de forma explícita:
// 1) credita o valor ganho (prêmio cheio, incluindo a aposta de volta)
// 2) se deu lucro, debita a taxa da casa DIRETO da conta do jogador e manda pro imposto
function resolverAposta(conta, aposta, ganhoBruto) {
    conta.carteira += ganhoBruto;
    const lucro = ganhoBruto - aposta;
    let taxa = 0;
    if (lucro > 0) {
        taxa = Math.ceil(lucro * TAXA_CASA);
        conta.carteira -= taxa; // sai da conta do membro
        impostoArrecadado += taxa; // e vai pro imposto
    }
    return { lucro, taxa };
}

// Interpreta o valor de uma aposta/transação: número puro ou "tudo"/"all"
function parseValorEconomia(texto, saldoDisponivel) {
    if (!texto) return NaN;
    const t = texto.trim().toLowerCase();
    if (t === 'tudo' || t === 'all') return saldoDisponivel;
    const valor = parseInt(t.replace(/\./g, ''), 10);
    return Number.isInteger(valor) ? valor : NaN;
}

// Calcula quanto uma pessoa deve de empréstimo agora, aplicando juros
// compostos a cada período de 2 dias além do prazo de carência.
function calcularDividaAtual(conta) {
    if (!conta.emprestimo) return 0;

    const agora = Date.now();
    const decorrido = agora - conta.emprestimo.dataPegou;

    if (decorrido <= PRAZO_EMPRESTIMO_MS) {
        return conta.emprestimo.valor;
    }

    const atraso = decorrido - PRAZO_EMPRESTIMO_MS;
    const periodosAtraso = Math.floor(atraso / PRAZO_EMPRESTIMO_MS) + 1;

    return Math.ceil(conta.emprestimo.valor * Math.pow(1 + JUROS_EMPRESTIMO, periodosAtraso));
}

// ---------- Baralho (blackjack) ----------
const NAIPES_CARTA = ['♠️', '♥️', '♦️', '♣️'];
const VALORES_CARTA = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function criarBaralho() {
    const baralho = [];
    for (const naipe of NAIPES_CARTA) {
        for (const valor of VALORES_CARTA) {
            baralho.push({ valor, naipe });
        }
    }
    for (let i = baralho.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [baralho[i], baralho[j]] = [baralho[j], baralho[i]];
    }
    return baralho;
}

function valorCarta(carta) {
    if (carta.valor === 'A') return 11;
    if (carta.valor === 'J' || carta.valor === 'Q' || carta.valor === 'K') return 10;
    return parseInt(carta.valor, 10);
}

function valorMao(mao) {
    let total = mao.reduce((soma, c) => soma + valorCarta(c), 0);
    let ases = mao.filter(c => c.valor === 'A').length;
    while (total > 21 && ases > 0) {
        total -= 10;
        ases--;
    }
    return total;
}

// Detecta "soft 17" (17 com um Ás ainda valendo 11) — dealer compra nesse caso
function maoEhMole(mao) {
    const ases = mao.filter(c => c.valor === 'A').length;
    if (ases === 0) return false;
    const total = valorMao(mao);
    const totalDuro = mao.reduce((s, c) => s + (c.valor === 'A' ? 1 : valorCarta(c)), 0);
    return total === 17 && (total - totalDuro) >= 10;
}

function formatarMao(mao) {
    return mao.map(c => `${c.valor}${c.naipe}`).join(' ');
}

// ---------- Caça-níquel ----------
// Só paga na trinca (removemos o pagamento por par pra diminuir a chance de ganhar).
// Quanto mais raro o emoji (menor peso), maior o multiplicador.
const SLOT_EMOJIS = [
    { emoji: '🍒', peso: 30, nome: 'cereja', multiTripla: 3 },
    { emoji: '🍋', peso: 25, nome: 'limao', multiTripla: 4 },
    { emoji: '🍊', peso: 20, nome: 'laranja', multiTripla: 5 },
    { emoji: '🔔', peso: 15, nome: 'sino', multiTripla: 8 },
    { emoji: '⭐', peso: 7, nome: 'estrela', multiTripla: 20 },
    { emoji: '💎', peso: 3, nome: 'diamante', multiTripla: 50 }
];

function sortearSlot() {
    const totalPeso = SLOT_EMOJIS.reduce((soma, e) => soma + e.peso, 0);
    let roll = Math.random() * totalPeso;
    for (const e of SLOT_EMOJIS) {
        if (roll < e.peso) return e;
        roll -= e.peso;
    }
    return SLOT_EMOJIS[0];
}

// ---------- Roleta ----------
// 37 posições estilo roleta europeia: 0 é verde, o resto alterna vermelho/preto.
const POSICOES_ROLETA = (() => {
    const posicoes = ['verde'];
    for (let i = 1; i <= 36; i++) {
        posicoes.push(i % 2 === 0 ? 'preto' : 'vermelho');
    }
    return posicoes;
})();

function girarRoleta() {
    const numero = Math.floor(Math.random() * POSICOES_ROLETA.length);
    return { numero, cor: POSICOES_ROLETA[numero] };
}

// Pagamentos reduzidos (parte do ajuste pra aumentar a vantagem da casa)
const MULTIPLICADOR_ROLETA_COR = 1.8;
const MULTIPLICADOR_ROLETA_VERDE = 12;

// ---------- Jogo da Bola (multiplayer, com lobby de 30s) ----------
// channelId -> { jogadores: Map(userId -> {aposta, username}), timeout }
const jogosBola = new Map();
const TEMPO_LOBBY_BOLA = 30000;

// ---------- Corrida de Cavalos (multiplayer, com lobby de 30s) ----------
const CAVALOS = [
    { id: 1, nome: 'Mejiro Mcqueen', emoji: '🐎', peso: 30, multiplicador: 2 },
    { id: 2, nome: 'Rice Shower', emoji: '🐴', peso: 25, multiplicador: 2.5 },
    { id: 3, nome: 'Special Week', emoji: '🦄', peso: 20, multiplicador: 3 },
    { id: 4, nome: 'Silence Suzuka', emoji: '🐎', peso: 15, multiplicador: 4 },
    { id: 5, nome: 'Agnes Tachyon', emoji: '🐴', peso: 10, multiplicador: 6 }
];

function sortearCavaloVencedor() {
    const totalPeso = CAVALOS.reduce((s, c) => s + c.peso, 0);
    let roll = Math.random() * totalPeso;
    for (const c of CAVALOS) {
        if (roll < c.peso) return c;
        roll -= c.peso;
    }
    return CAVALOS[0];
}

// channelId -> { apostas: Map(userId -> {aposta, cavaloId, username}), timeout }
const jogosCorrida = new Map();
const TEMPO_LOBBY_CORRIDA = 30000;

// Resolve o Jogo da Bola: sorteia um vencedor ponderado pelo valor apostado
// (quem apostou mais tem mais chance) e entrega o pote inteiro pra ele.
async function resolverJogoBola(canalId, canalTexto) {
    const jogo = jogosBola.get(canalId);
    if (!jogo) return;
    jogosBola.delete(canalId);

    const jogadores = [...jogo.jogadores.entries()];

    if (jogadores.length < 2) {
        for (const [userId, dados] of jogadores) {
            pegarConta(userId).carteira += dados.aposta;
        }
        salvarDados();
        try {
            await canalTexto.send('⚽ Ninguém mais entrou no jogo da bola a tempo. Aposta devolvida.');
        } catch (_) {}
        return;
    }

    const poteTotal = jogadores.reduce((soma, [, d]) => soma + d.aposta, 0);

    let roll = Math.random() * poteTotal;
    let vencedorId = jogadores[0][0];
    let vencedorDados = jogadores[0][1];
    for (const [userId, dados] of jogadores) {
        if (roll < dados.aposta) {
            vencedorId = userId;
            vencedorDados = dados;
            break;
        }
        roll -= dados.aposta;
    }

    const contaVencedor = pegarConta(vencedorId);
    const { lucro, taxa } = resolverAposta(contaVencedor, vencedorDados.aposta, poteTotal);
    const subiuNivel = ganharXp(contaVencedor, vencedorDados.aposta + Math.max(0, lucro));
    salvarDados();

    try {
        await canalTexto.send(
            `⚽ **A bola parou!** Vencedor: **${vencedorDados.username}**!\n` +
            `Pote total: ${formatarMoeda(poteTotal)} | Lucro líquido: ${formatarMoeda(lucro)} (taxa da casa: ${formatarMoeda(taxa)})` +
            (subiuNivel ? `\n🌟 **${vencedorDados.username}** subiu para o nível ${contaVencedor.nivel}!` : '')
        );
    } catch (_) {}
}

// Resolve a Corrida de Cavalos: sorteia o cavalo vencedor e paga quem apostou nele.
async function resolverCorrida(canalId, canalTexto) {
    const corrida = jogosCorrida.get(canalId);
    if (!corrida) return;
    jogosCorrida.delete(canalId);

    const apostas = [...corrida.apostas.entries()];
    if (apostas.length === 0) return;

    const vencedor = sortearCavaloVencedor();
    const mensagens = [];
    let algumGanhou = false;

    for (const [userId, dados] of apostas) {
        const conta = pegarConta(userId);
        if (dados.cavaloId === vencedor.id) {
            const ganho = Math.round(dados.aposta * vencedor.multiplicador);
            const { lucro, taxa } = resolverAposta(conta, dados.aposta, ganho);
            const subiuNivel = ganharXp(conta, dados.aposta + Math.max(0, lucro));
            algumGanhou = true;
            mensagens.push(
                `🏆 **${dados.username}** ganhou ${formatarMoeda(lucro)} de lucro (taxa: ${formatarMoeda(taxa)})` +
                (subiuNivel ? ` — subiu pro nível ${conta.nivel}!` : '')
            );
        } else {
            ganharXp(conta, dados.aposta * 0.5);
        }
    }

    salvarDados();

    try {
        await canalTexto.send(
            `🏇 **A corrida acabou!** Cavalo vencedor: ${vencedor.emoji} **${vencedor.nome}**\n\n` +
            (algumGanhou ? mensagens.join('\n') : '😢 Ninguém apostou no cavalo vencedor dessa vez.')
        );
    } catch (_) {}
}

// ---------- Jogo de UNO (multiplayer, lobby de 30s, mãos mandadas por DM) ----------
// channelId -> { emLobby, emAndamento, jogadores: [userId...], usernames: {id: nome},
//                maos: Map(userId -> [carta...]), baralho: [carta...], descarte: [carta...],
//                corAtual, indiceAtual, direcao }
const jogosUno = new Map();
const TEMPO_LOBBY_UNO = 30000;
const MAX_JOGADORES_UNO = 8;

const EMOJI_COR_UNO = { vermelho: '🔴', azul: '🔵', verde: '🟢', amarelo: '🟡' };
const NOMES_COR_UNO = { vermelho: 'Vermelho', azul: 'Azul', verde: 'Verde', amarelo: 'Amarelo' };
const NOMES_ESPECIAIS_UNO = { pular: 'Pular', reverter: 'Reverter', '+2': '+2' };

// Descreve a cor atual da mesa em texto + emoji (nunca só o emoji, pra não
// depender dele renderizar/copiar certo em todo cliente).
function formatarCorAtualUno(corAtual) {
    if (!corAtual) return '⚫ (nenhuma)';
    return `${EMOJI_COR_UNO[corAtual] || '⚫'} ${NOMES_COR_UNO[corAtual] || corAtual}`;
}

// Monta um baralho completo de UNO (108 cartas) já embaralhado.
function criarBaralhoUno() {
    const cores = ['vermelho', 'azul', 'verde', 'amarelo'];
    const baralho = [];

    for (const cor of cores) {
        baralho.push({ cor, valor: '0' });
        for (let n = 1; n <= 9; n++) {
            baralho.push({ cor, valor: String(n) });
            baralho.push({ cor, valor: String(n) });
        }
        for (let i = 0; i < 2; i++) {
            baralho.push({ cor, valor: 'pular' });
            baralho.push({ cor, valor: 'reverter' });
            baralho.push({ cor, valor: '+2' });
        }
    }

    for (let i = 0; i < 4; i++) {
        baralho.push({ cor: null, valor: 'curinga' });
        baralho.push({ cor: null, valor: '+4' });
    }

    for (let i = baralho.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [baralho[i], baralho[j]] = [baralho[j], baralho[i]];
    }

    return baralho;
}

function formatarCartaUno(carta) {
    if (!carta.cor) return carta.valor === '+4' ? '⚫ +4' : '⚫ Curinga';
    return `${EMOJI_COR_UNO[carta.cor]} ${NOMES_COR_UNO[carta.cor]} ${NOMES_ESPECIAIS_UNO[carta.valor] || carta.valor}`;
}

function cartaJogavelUno(carta, topo, corAtual) {
    if (!carta.cor) return true; // curinga e +4 sempre podem ser jogados
    if (carta.cor === corAtual) return true;
    if (carta.valor === topo.valor) return true;
    return false;
}

// Compra `quantidade` cartas do baralho, reembaralhando o descarte (menos o topo)
// de volta pro baralho se ele acabar no meio da compra.
function comprarCartasUno(jogo, quantidade) {
    const compradas = [];

    for (let i = 0; i < quantidade; i++) {
        if (jogo.baralho.length === 0) {
            if (jogo.descarte.length <= 1) break; // não sobrou carta em lugar nenhum

            const topo = jogo.descarte.pop();
            jogo.baralho = jogo.descarte;
            jogo.descarte = [topo];

            for (let j = jogo.baralho.length - 1; j > 0; j--) {
                const k = Math.floor(Math.random() * (j + 1));
                [jogo.baralho[j], jogo.baralho[k]] = [jogo.baralho[k], jogo.baralho[j]];
            }
        }

        compradas.push(jogo.baralho.pop());
    }

    return compradas;
}

// Calcula o índice do próximo jogador, respeitando a direção da mesa e se
// o próximo deve ser pulado (Pular, Reverter com 2 jogadores, +2, +4).
function proximoIndiceUno(jogo, pular) {
    const n = jogo.jogadores.length;
    const passos = pular ? 2 : 1;
    let novoIndice = (jogo.indiceAtual + jogo.direcao * passos) % n;
    if (novoIndice < 0) novoIndice += n;
    return novoIndice;
}

// Manda a mão atualizada por DM — se a DM estiver fechada, o jogo continua
// (a pessoa só vai precisar confiar no anúncio público do canal).
async function enviarMaoUnoPorDm(jogo, userId) {
    try {
        const usuario = await client.users.fetch(userId);
        const mao = jogo.maos.get(userId) || [];
        const lista = mao.map((c, i) => `${i + 1}. ${formatarCartaUno(c)}`).join('\n');
        const topo = jogo.descarte[jogo.descarte.length - 1];

        await usuario.send(
            `🎮 **Sua mão no UNO:**\n${lista}\n\n` +
            `Carta no topo: ${formatarCartaUno(topo)} | Cor atual: ${formatarCorAtualUno(jogo.corAtual)}\n\n` +
            'No canal do servidor, jogue com `p!uno jogar <número>` — o número é a **posição da carta na lista acima** ' +
            '(ex: `p!uno jogar 3` joga a 3ª carta da lista, não uma carta "3").\n' +
            'Se a carta for curinga/+4, escolha a cor também: `p!uno jogar 3 vermelho`.\n' +
            'Pra comprar uma carta: `p!uno comprar`.'
        );
    } catch (_) {}
}

async function anunciarTurnoUno(jogo, canalTexto) {
    const userId = jogo.jogadores[jogo.indiceAtual];
    await enviarMaoUnoPorDm(jogo, userId);

    const topo = jogo.descarte[jogo.descarte.length - 1];
    const quantidadeCartas = (jogo.maos.get(userId) || []).length;

    try {
        await canalTexto.send(
            `👉 É a vez de **${jogo.usernames[userId]}**! Carta no topo: ${formatarCartaUno(topo)} | ` +
            `Cor atual: ${formatarCorAtualUno(jogo.corAtual)} — ${quantidadeCartas} carta(s) na mão. ` +
            '(confira sua mão na DM do bot)'
        );
    } catch (_) {}
}

async function iniciarJogoUno(canalId, canalTexto) {
    const jogo = jogosUno.get(canalId);
    if (!jogo || !jogo.emLobby) return;

    if (jogo.jogadores.length < 2) {
        jogosUno.delete(canalId);
        try { await canalTexto.send('🎮 Ninguém mais entrou no UNO a tempo. Mesa cancelada.'); } catch (_) {}
        return;
    }

    jogo.emLobby = false;
    jogo.emAndamento = true;
    jogo.baralho = criarBaralhoUno();

    for (const userId of jogo.jogadores) {
        jogo.maos.set(userId, jogo.baralho.splice(0, 7));
    }

    // Vira a primeira carta do descarte — se cair curinga/+4, devolve e tenta outra,
    // pra começar sempre com uma cor e valor definidos.
    let primeira = jogo.baralho.pop();
    while (!primeira.cor) {
        jogo.baralho.unshift(primeira);
        primeira = jogo.baralho.pop();
    }
    jogo.descarte = [primeira];
    jogo.corAtual = primeira.cor;

    try {
        await canalTexto.send(
            `🎮 **UNO começou!** ${jogo.jogadores.length} jogadores: ${jogo.jogadores.map(id => `**${jogo.usernames[id]}**`).join(', ')}\n` +
            `Carta inicial: ${formatarCartaUno(primeira)}\n` +
            'Cada um recebeu 7 cartas — confira sua mão na DM do bot!'
        );
    } catch (_) {}

    // Manda a mão inicial pra TODO MUNDO, não só pra quem joga primeiro —
    // senão os outros jogadores ficam sem saber o que têm na mão até sua vez chegar.
    // (quem já vai jogar primeiro recebe a DM logo abaixo, via anunciarTurnoUno)
    for (const userId of jogo.jogadores) {
        if (userId === jogo.jogadores[jogo.indiceAtual]) continue;
        await enviarMaoUnoPorDm(jogo, userId);
    }

    await anunciarTurnoUno(jogo, canalTexto);
}


// ---------- Persistência em disco (arquivo dados.json) ----------
// Tudo que precisa sobreviver a um reinício do bot é salvo aqui.

const ARQUIVO_DADOS = path.join(__dirname, 'dados.json');

function estadoPadrao() {
    return {
        avisos: {},
        capsulasPendentes: [],
        murais: {},
        changelogs: {},
        snapshots: {},
        votacoesAtivas: {},
        economia: {},
        impostoArrecadado: 0,
        sessoesAtivas: {},
        faltasSessao: {},
        contasConjuntas: {}
    };
}

function carregarDoDisco() {
    try {
        if (!fs.existsSync(ARQUIVO_DADOS)) {
            return estadoPadrao();
        }
        const bruto = fs.readFileSync(ARQUIVO_DADOS, 'utf8');
        return { ...estadoPadrao(), ...JSON.parse(bruto) };
    } catch (erro) {
        console.error('Erro ao carregar dados.json, começando do zero:', erro);
        return estadoPadrao();
    }
}

const dadosCarregados = carregarDoDisco();

const avisos = new Map(Object.entries(dadosCarregados.avisos));

// Migração: versões antigas do bot guardavam só um número (contagem) de
// avisos por pessoa. Agora guardamos uma lista com motivo/data/autor de cada
// aviso, então convertemos qualquer entrada antiga pro novo formato.
for (const [idUsuario, valor] of avisos) {
    if (typeof valor === 'number') {
        const listaConvertida = [];
        for (let i = 0; i < valor; i++) {
            listaConvertida.push({ motivo: 'Aviso antigo (sem detalhes registrados)', autorId: null, data: null });
        }
        avisos.set(idUsuario, listaConvertida);
    }
}

const capsulasPendentes = dadosCarregados.capsulasPendentes; // array, já pronto
const murais = new Map(Object.entries(dadosCarregados.murais));
const changelogs = new Map(Object.entries(dadosCarregados.changelogs));
const snapshots = new Map(Object.entries(dadosCarregados.snapshots));
const votacoesAtivas = new Map(Object.entries(dadosCarregados.votacoesAtivas));

// economia: objeto simples userId -> { carteira, banco, nivel, casadoCom }
const economia = dadosCarregados.economia;
// impostoArrecadado é um número solto (não Map) porque é um valor único global
let impostoArrecadado = dadosCarregados.impostoArrecadado || 0;

// sessoesAtivas: guildId -> { canalId, alvoMs, chamada1Em, chamada2Em, enviouChamada1/2/3, janelaAberta, presentes: [userIds] }
const sessoesAtivas = new Map(Object.entries(dadosCarregados.sessoesAtivas));
// faltasSessao: userId -> quantidade de FALTAS seguidas (0, 1, 2 — zera ou vira aviso ao chegar em 3)
const faltasSessao = dadosCarregados.faltasSessao;
// contasConjuntas: "idA_idB" (ordenados) -> { carteira, banco } — cofre compartilhado do anel de noivado
const contasConjuntas = dadosCarregados.contasConjuntas;

function salvarDados() {
    try {
        const paraSalvar = {
            avisos: Object.fromEntries(avisos),
            capsulasPendentes,
            murais: Object.fromEntries(murais),
            changelogs: Object.fromEntries(changelogs),
            snapshots: Object.fromEntries(snapshots),
            votacoesAtivas: Object.fromEntries(votacoesAtivas),
            economia,
            impostoArrecadado,
            sessoesAtivas: Object.fromEntries(sessoesAtivas),
            faltasSessao,
            contasConjuntas
        };
        fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(paraSalvar, null, 2));
    } catch (erro) {
        console.error('Erro ao salvar dados.json:', erro);
    }
}

// ---------- Sessões (p!sessão) ----------

// Canal onde as chamadas 1/3, 2/3 e 3/3 da sessão são enviadas (sempre esse,
// não importa onde o comando p!sessão foi digitado)
const CANAL_CHAMADAS_SESSAO = '1524910258856923148';

// Canal onde o bot avisa quando alguém bate 3/3 faltas seguidas
const CANAL_AVISO_PRESENCA = '1524913894458527766';

// Quantos ms de diferença o GMT-3 tem do UTC (GMT-3 = UTC - 3h)
const OFFSET_GMT3_MS = 3 * 60 * 60 * 1000;

// Recebe "HH:MM" (horário em GMT-3) e retorna o timestamp (ms, UTC real) desse
// horário HOJE. Se esse horário já passou hoje, retorna null — o comando não
// agenda pra amanhã sozinho, só quando a pessoa usar o comando de novo.
function proximoHorarioGMT3(horaStr) {
    const match = (horaStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const hora = parseInt(match[1], 10);
    const minuto = parseInt(match[2], 10);
    if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) return null;

    const agora = Date.now();
    // "agora" reescrito como se o relógio de GMT-3 fosse UTC, só pra facilitar a conta
    const agoraFake = new Date(agora - OFFSET_GMT3_MS);

    const alvoFake = Date.UTC(
        agoraFake.getUTCFullYear(),
        agoraFake.getUTCMonth(),
        agoraFake.getUTCDate(),
        hora,
        minuto,
        0,
        0
    );

    const alvoReal = alvoFake + OFFSET_GMT3_MS;

    // se esse horário já passou hoje, não agenda automaticamente
    if (alvoReal <= agora) {
        return null;
    }

    return alvoReal;
}

// Formata um timestamp (ms UTC) como "HH:MM" no fuso GMT-3 fixo — usado na
// mensagem de confirmação, já que o <t:...:t> do Discord mostra a hora no
// fuso de quem está lendo, não no GMT-3 fixo do bot.
function formatarHoraGMT3(ms) {
    const d = new Date(ms - OFFSET_GMT3_MS);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

// Roda quando a chamada 3/3 é enviada: fecha a janela, confere quem respondeu
// "Eu" e atualiza o contador de faltas seguidas de cada membro do servidor.
async function processarFimSessao(sessao) {
    try {
        const guild = await client.guilds.fetch(sessao.guildId);
        await guild.members.fetch(); // garante que o cache de membros está completo

        const canalAviso = await client.channels.fetch(CANAL_AVISO_PRESENCA).catch((erro) => {
            console.error(`Erro ao buscar o canal de aviso de presença (${CANAL_AVISO_PRESENCA}):`, erro);
            return null;
        });

        if (!canalAviso) {
            console.error(`Canal de aviso de presença (${CANAL_AVISO_PRESENCA}) não foi encontrado ou o bot não tem acesso a ele. Nenhum aviso de falta será enviado nesta sessão.`);
        }

        for (const [userId, membro] of guild.members.cache) {
            if (membro.user.bot) continue;

            const presente = sessao.presentes.includes(userId);

            if (presente) {
                faltasSessao[userId] = 0; // compareceu, zera a sequência de faltas
            } else {
                const atual = (faltasSessao[userId] || 0) + 1;

                if (atual >= 3) {
                    faltasSessao[userId] = 0; // zera depois de avisar

                    if (canalAviso) {
                        await canalAviso.send({
                            content: `🚨 **${membro.user.username}** (<@${userId}>) bateu **3/3** faltas seguidas nas chamadas de sessão!`,
                            allowedMentions: { users: [userId] }
                        }).catch((erro) => {
                            console.error(`Erro ao enviar aviso de falta pra ${membro.user.username} (${userId}) no canal ${CANAL_AVISO_PRESENCA}:`, erro);
                        });
                    }
                } else {
                    faltasSessao[userId] = atual;
                }
            }
        }

        salvarDados();
    } catch (erro) {
        console.error('Erro ao processar fim de sessão:', erro);
    }
}

function fatoAleatorio() {
    return fatosCuriosos[Math.floor(Math.random() * fatosCuriosos.length)];
}

function dicaDiscord() {
    const dicas = [
        'Você pode segurar Shift ao clicar em um canal pra copiar o link direto dele.',
        'Ctrl/Cmd + K abre a busca rápida de servidores e canais.',
        'Você pode editar mensagens enviadas por engano com a tecla seta pra cima no campo vazio.',
        'Clicar com o botão direito num usuário e escolher "Copiar ID" exige o modo desenvolvedor ativado.',
        'Você pode fixar mensagens importantes clicando com o botão direito nelas.',
        'Servidores podem ter até 5 categorias de emojis animados se tiverem boost suficiente.',
        'Use markdown com ||spoiler|| pra esconder texto até alguém clicar.'
    ];
    return dicas[Math.floor(Math.random() * dicas.length)];
}

// ---------- Sistema de música ----------
// guildId -> { connection, player, canalTexto, musicas: [], loop: boolean, timeoutSaida }
const filas = new Map();

function ehLinkYoutube(texto) {
    return /(youtube\.com|youtu\.be)/i.test(texto);
}

function ehLinkSpotify(texto) {
    return /open\.spotify\.com/i.test(texto);
}

// Spotify não libera o áudio da música pela API — só dá pra pegar o título
// (via oembed, sem precisar de chave de API) e procurar o equivalente no YouTube.
async function resolverQuery(texto) {
    if (ehLinkSpotify(texto)) {
        const resposta = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(texto)}`);
        if (!resposta.ok) {
            throw new Error('Não consegui ler esse link do Spotify.');
        }
        const dados = await resposta.json();
        return dados.title;
    }
    return texto;
}

function formatarDuracao(segundos) {
    const m = Math.floor(segundos / 60);
    const s = Math.floor(segundos % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function tocarProximaMusica(guildId) {
    const fila = filas.get(guildId);
    if (!fila) return;

    if (fila.musicas.length === 0) {
        // ninguém tocando — sai do canal de voz depois de 5 min parado
        fila.timeoutSaida = setTimeout(() => {
            const f = filas.get(guildId);
            if (f && f.musicas.length === 0) {
                f.connection.destroy();
                filas.delete(guildId);
            }
        }, 5 * 60 * 1000);
        return;
    }

    if (fila.timeoutSaida) {
        clearTimeout(fila.timeoutSaida);
        fila.timeoutSaida = null;
    }

    const musica = fila.musicas[0];

    try {
        const recurso = criarRecursoAudio(musica.url);
        fila.player.play(recurso);

        fila.canalTexto.send(
            `▶️ Tocando agora: **${musica.titulo}** (${formatarDuracao(musica.duracao)}) — pedido por ${musica.pedidoPor}`
        ).catch(() => {});
    } catch (erro) {
        console.error('Erro ao tocar música:', erro);
        fila.canalTexto.send(`❌ Não consegui tocar **${musica.titulo}**, pulando.`).catch(() => {});
        fila.musicas.shift();
        tocarProximaMusica(guildId);
    }
}

// Garante que existe uma fila/conexão de voz pro servidor, criando se precisar.
// Retorna a fila pronta pra usar, ou null se não conseguiu conectar.
async function garantirFila(message) {
    let fila = filas.get(message.guild.id);
    if (fila) return fila;

    const connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    fila = {
        connection,
        player,
        canalTexto: message.channel,
        musicas: [],
        loop: false,
        timeoutSaida: null
    };
    filas.set(message.guild.id, fila);

    player.on(AudioPlayerStatus.Idle, () => {
        const f = filas.get(message.guild.id);
        if (!f) return;
        if (!f.loop) f.musicas.shift();
        tocarProximaMusica(message.guild.id);
    });

    player.on('error', (erro) => {
        console.error('Erro no player de música:', erro);
        const f = filas.get(message.guild.id);
        if (f) {
            f.musicas.shift();
            tocarProximaMusica(message.guild.id);
        }
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
    } catch (erro) {
        connection.destroy();
        filas.delete(message.guild.id);
        return null;
    }

    return fila;
}

// Processa faixas de uma playlist/álbum do Spotify em segundo plano: busca
// cada uma no YouTube e vai empilhando na fila conforme resolve, sem travar
// o bot esperando a playlist inteira terminar de ser buscada.
async function processarFaixasEmBackground(guildId, faixas, canalTexto) {
    let adicionadas = 0;
    let falhas = 0;

    for (const faixa of faixas) {
        const fila = filas.get(guildId);
        if (!fila) break; // bot saiu do canal de voz nesse meio tempo, aborta

        try {
            const termo = faixa.artista ? `${faixa.artista} - ${faixa.titulo}` : faixa.titulo;
            const info = await buscarInfoMusica(termo);
            if (!info) {
                falhas++;
                continue;
            }

            fila.musicas.push({ ...info, pedidoPor: faixa.pedidoPor });
            adicionadas++;

            if (fila.musicas.length === 1 && fila.player.state.status !== AudioPlayerStatus.Playing) {
                tocarProximaMusica(guildId);
            }
        } catch (erro) {
            console.error(`Erro ao buscar "${faixa.titulo}":`, erro);
            falhas++;
        }
    }

    try {
        await canalTexto.send(
            `✅ Playlist processada: ${adicionadas} música(s) adicionada(s) à fila` +
            (falhas > 0 ? `, ${falhas} não encontrada(s).` : '.')
        );
    } catch (_) {}
}

// Processa um comando (chamado tanto pelo messageCreate quanto pelos slash commands,
// que constroem uma "mensagem falsa" equivalente e chamam essa função).
async function processarComando(message) {

    try {

        // ---------- Comandos permitidos em DM (fora de servidor) ----------
        // Só os comandos que funcionam inteiramente com dados da conta (economia, diversão),
        // sem precisar de cargo, canal ou membro do servidor. O resto só funciona no servidor.
        if (!message.guild && message.content.startsWith('p!')) {
            const COMANDOS_PERMITIDOS_DM = [
                'p!ajuda', 'p!help',
                'p!escolher', 'p!dado', 'p!moeda', 'p!8ball', 'p!ship', 'p!gay',
                'p!fato', 'p!dica', 'p!gato',
                'p!perfil', 'p!casar', 'p!divorciar',
                'p!loja', 'p!comprar', 'p!titulo', 'p!título',
                'p!trabalhar', 'p!crime', 'p!diario',
                'p!depositar', 'p!sacar', 'p!transferir', 'p!cobrar',
                'p!emprestimo', 'p!pagar', 'p!divida',
                'p!blackjack', 'p!cacaniquel', 'p!caçaniquel', 'p!roleta', 'p!bola', 'p!corrida'
            ];

            if (!comandoBate(message.content, ...COMANDOS_PERMITIDOS_DM)) {
                return message.reply('❌ Esse comando só funciona dentro do servidor. Em DM, só funcionam os comandos de economia e diversão (veja `p!ajuda`).');
            }
        }

        // Canal onde ninguém além dos donos pode usar comandos do bot (exceto os poderes dos Miraculous, que são permitidos aqui)
        const CANAL_PROIBIDO_COMANDOS = '1524910258856923148';
        if (message.channel.id === CANAL_PROIBIDO_COMANDOS && message.content.startsWith('p!') && !ehDono(message) && !ehComandoDePoder(message.content)) {
            message.delete().catch(() => {});
            message.channel.send('🚫 Comandos não são permitidos nesse canal.')
                .then(aviso => setTimeout(() => aviso.delete().catch(() => {}), 5000))
                .catch(() => {});
            return;
        }

        // Os poderes dos Miraculous só podem ser usados no canal designado (donos do bot não têm essa restrição)
        if (ehComandoDePoder(message.content) && message.channel.id !== CANAL_PODERES_MIRACULOUS && !ehDono(message)) {
            return message.reply(`❌ Os poderes dos Miraculous só podem ser usados em <#${CANAL_PODERES_MIRACULOUS}>.`);
        }

        // Contagem de presença da sessão (p!sessão) — só conta "Eu" enquanto a
        // janela estiver aberta (entre a chamada 1/3 e a chamada 3/3) e só no
        // canal onde a sessão foi marcada.
        if (message.guild) {
            const sessao = sessoesAtivas.get(message.guild.id);
            if (sessao && sessao.janelaAberta && message.channel.id === sessao.canalId) {
                const textoLimpo = message.content.trim().toLowerCase().replace(/[!.,]/g, '');
                if (textoLimpo === 'eu' && !sessao.presentes.includes(message.author.id)) {
                    sessao.presentes.push(message.author.id);
                    salvarDados();
                    message.react('✅').catch(() => {});
                }
            }
        }

        // Rosna
        if (message.content === 'p!rosna rosna') {
            return message.reply('miauuuuuuuuu 🐈');
        }

        // Ajuda
        if (message.content === 'p!ajuda' || message.content === 'p!help') {

            const embedAjuda = new EmbedBuilder()
                .setTitle('📜 Comandos do Sr. Pimbolinhas')
                .setColor(0x5865F2)
                .addFields(
                    {
                        name: '🎉 Diversão',
                        value:
                            '`p!escolher opção1 | opção2` — sorteia entre as opções\n' +
                            '`p!dado` ou `p!dado 20` — rola um dado (padrão d6)\n' +
                            '`p!moeda` — cara ou coroa\n' +
                            '`p!8ball pergunta` — bola 8 mágica\n' +
                            '`p!ship @user1 @user2` — compatibilidade entre dois membros\n' +
                            '`p!gay [@user]` — porcentagem aleatória (só brincadeira)\n' +
                            '`p!fato` — fato curioso aleatório\n' +
                            '`p!dica` — dica de uso do Discord\n' +
                            '`p!gato` — foto aleatória de gato\n' +
                            '`p!perguntar pergunta` — pergunta pro Sr. Pimbolinhas'
                    },
                    {
                        name: '🛠️ Moderação (exigem permissão)',
                        value:
                            '`p!limpar quantidade` — apaga mensagens\n' +
                            '`p!purgemember @membro` — apaga as mensagens do membro em TODOS os canais\n' +
                            '`p!slowmode segundos` — define o slowmode do canal\n' +
                            '`p!trancar` / `p!destrancar` — tranca/destranca o canal atual\n' +
                            '`p!lockdown` / `p!openup` — tranca/destranca TODOS os canais\n' +
                            '`p!nuke` — recria o canal do zero\n' +
                            '`p!ban @user motivo` — bane um membro\n' +
                            '`p!unban ID` — desbane pelo ID\n' +
                            '`p!mute @user duração motivo` — muta (timeout) por um tempo, ex: 10m, 2h\n' +
                            '`p!desmutar @user` — remove o mute antes do tempo acabar\n' +
                            '`p!aviso @user motivo` — avisa um membro\n' +
                            '`p!warnings [@user]` — histórico de avisos (livre pra ver o seu próprio)\n' +
                            '`p!userinfo [@user]` — informações de um membro (livre)\n' +
                            '`p!serverinfo` — informações do servidor (livre)'
                    },
                    {
                        name: '🤖 Automação (exigem permissão)',
                        value:
                            '`p!embed #canal | Título | Descrição` — cria um embed\n' +
                            '`p!enquete pergunta | opção1 | opção2` — votação simples\n' +
                            '`p!votacao pergunta | opções` — votação completa (reply "p!votacao fechar" pra apurar)\n' +
                            '`p!sugestao ideia` — envia uma sugestão\n' +
                            '`p!sorteio duração | prêmio | vencedores` — ex: 60s, 10m, 2h\n' +
                            '`p!contadorregressivo duração | evento` — ex: 2h | Sessão\n' +
                            '`p!capsula AAAA-MM-DD | mensagem` — revela numa data futura\n' +
                            '`p!sessão HH:MM` — agenda as chamadas 1/3, 2/3 e 3/3 (fuso GMT-3)\n' +
                            '`p!sessão cancelar` — cancela a sessão agendada\n' +
                            '`p!sessão status` — vê se tem sessão agendada e em que etapa está (livre)\n' +
                            '`p!faltas [@user]` — vê quantas faltas seguidas alguém tem (livre)'
                    },
                    {
                        name: '🤖 Automação (continuação)',
                        value:
                            '`p!mural` (livre) / `p!mural add texto` / `p!mural remover nº`\n' +
                            '`p!changelog` (livre) / `p!changelog add texto`\n' +
                            '`p!estatisticas` — painel completo do servidor\n' +
                            '`p!snapshot salvar` / `p!snapshot comparar`'
                    },
                    {
                        name: '🎵 Música (livres)',
                        value:
                            '`p!tocar nome/link` — toca ou adiciona na fila (aceita link do YouTube ou do Spotify)\n' +
                            '`p!fila` — mostra a fila atual\n' +
                            '`p!pular` — pula pra próxima música\n' +
                            '`p!pausar` / `p!continuar` — pausa/retoma\n' +
                            '`p!parar` — para tudo e sai do canal de voz\n' +
                            '`p!loop` — ativa/desativa repetição da música atual'
                    },
                    {
                        name: '💰 Economia (Miracoins)',
                        value:
                            '`p!perfil [@user]` — mostra nível e saldo\n' +
                            '`p!leaderboard [página]` — ranking de mais ricos (top 50, use ⬅️➡️ pra navegar)\n' +
                            '`p!casar @user` — pede em casamento (custa 25k, precisa aceitar)\n' +
                            '`p!divorciar` — termina o casamento\n' +
                            '`p!depositar (valor)` / `p!sacar (valor)` — banco (aceita "tudo")\n' +
                            '`p!pagarp (valor)` — paga imposto voluntariamente (vai direto pro fundo)\n' +
                            '`p!transferir @user (valor)` — manda Miracoins pra alguém\n' +
                            '`p!cobrar @user (valor)` — cobra alguém (precisa aceitar)\n' +
                            '`p!diario` — resgata recompensa diária (dobra a cada 5 dias de sequência)\n' +
                            '`p!emprestimo (valor)` — pega empréstimo do imposto arrecadado\n' +
                            '`p!pagar (valor)` / `p!divida` — paga ou vê sua dívida\n' +
                            '`p!trabalhar` — trabalho seguro, renda pequena (cooldown 1h)\n' +
                            '`p!crime` — arriscado: 40% de ganhar, 60% de multa (pode ficar devendo)\n' +
                            '`p!loja` — loja com categorias e páginas (cargos, títulos, casamento, miraculous)\n' +
                            '`p!comprar <item>` — compra um item da loja\n' +
                            '`p!titulo <id>` / `p!titulo remover` — equipa/remove um título comprado'
                    },
                    {
                        name: '✨ Poderes dos Miraculous',
                        value:
                            'Compre um Miraculous em `p!loja` pra desbloquear o poder:\n' +
                            '`p!talismã @user` (Joaninha) · `p!cataclismo` (Gato, respondendo a uma msg)\n' +
                            '`p!sentimonstro` (Pavão) · `p!miragem` (Raposa)\n' +
                            '`p!ferroada @user` (Abelha) · `p!proteção` (Tartaruga)\n' +
                            '`p!viajar` (Cavalo) · `p!segunda-chance` (Cobra)\n' +
                            '`p!resistencia` (Boi) · `p!pega! @user` (Cachorro)\n' +
                            '`p!colisão` (Tigre) · `p!libertar @user` (Águia) · `p!genesis` (Cabra)'
                    },
                    {
                        name: '🎲 Apostas',
                        value:
                            '`p!blackjack (valor)` — joga blackjack (`hit`/`parar`)\n' +
                            '`p!cacaniquel (valor)` — caça-níquel (só trinca paga)\n' +
                            '`p!roleta (valor) (vermelho|preto|verde)`\n' +
                            '`p!bola (valor)` — Jogo da Bola multiplayer (lobby de 30s)\n' +
                            '`p!corrida (valor) (nº do cavalo)` — corrida multiplayer (lobby de 30s)\\n' +
                            '`p!uno` — abre/entra numa mesa de UNO (lobby de 30s, mão vem por DM)'
                    },
                    {
                        name: '👑 Economia (só donos)',
                        value:
                            '`p!addmoney @user (valor)` / `p!removemoney @user (valor)`\n' +
                            '`p!addmoneytodos (valor)` — dá Miracoins pra todo mundo\n' +
                            '`p!aluguel (valor) @user` / `p!cobrarimposto (valor) @user`\n' +
                            '`p!impostogeral (valor)` — cobra todo mundo de uma vez\n' +
                            '`p!imposto` / `p!pegarimposto [valor]` — ver e sacar o imposto\n' +
                            '`p!addlevel @user (qtd)` / `p!removelevel @user (qtd)`'
                    },
                    {
                        name: '🌟 Outros (livres)',
                        value:
                            '`p!avatar [@user]` — mostra o avatar\n' +
                            '`p!contador` — total de membros, humanos e bots'
                    }
                );


            return message.reply({ embeds: [embedAjuda] });
        }

        // Escolher
        if (message.content.startsWith('p!escolher ')) {

            const opcoes = message.content
                .slice(11)
                .split('|')
                .map(x => x.trim())
                .filter(Boolean);

            if (opcoes.length < 2) {
                return message.reply(
                    'Use: p!escolher opção1 | opção2 | opção3'
                );
            }

            const escolhida =
                opcoes[Math.floor(Math.random() * opcoes.length)];

            return message.reply(`🎲 ${escolhida}`);
        }

        // Dado
        if (message.content.startsWith('p!dado')) {
            const partes = message.content.trim().split(/\s+/);
            let lados = parseInt(partes[1], 10);

            if (!Number.isInteger(lados) || lados < 2) {
                lados = 6;
            }

            const resultado = Math.floor(Math.random() * lados) + 1;
            return message.reply(`🎲 Você rolou um d${lados} e tirou **${resultado}**!`);
        }

        // Moeda
        if (message.content === 'p!moeda') {
            const resultado = Math.random() < 0.5 ? 'Cara 🪙' : 'Coroa 🪙';
            return message.reply(resultado);
        }

        // 8ball
        if (message.content.startsWith('p!8ball')) {
            const pergunta = message.content.slice(7).trim();

            if (!pergunta) {
                return message.reply('Use: p!8ball sua pergunta aqui');
            }

            const respostas = [
                'Com certeza. ✅',
                'Sem dúvidas. ✅',
                'Sim, definitivamente. ✅',
                'Pode confiar. ✅',
                'Minhas fontes dizem que não. ❌',
                'Muito improvável. ❌',
                'Não conte com isso. ❌',
                'Pergunte de novo mais tarde. 🔄',
                'Impossível prever agora. 🔮',
                'Concentre-se e pergunte de novo. 🔮'
            ];

            const resposta =
                respostas[Math.floor(Math.random() * respostas.length)];

            return message.reply(`🎱 ${resposta}`);
        }

        // Ship
        if (message.content.startsWith('p!ship')) {
            const usuarios = [...message.mentions.users.values()];

            let user1, user2;

            if (usuarios.length >= 2) {
                [user1, user2] = usuarios;
            } else if (usuarios.length === 1) {
                user1 = message.author;
                user2 = usuarios[0];
            } else {
                return message.reply('Use: p!ship @pessoa1 @pessoa2');
            }

            const seed = [user1.id, user2.id].sort().join('-') + hojeStr();
            const porcentagem = seedNumero(seed, 0, 100);

            let barra = '';
            const preenchido = Math.round(porcentagem / 10);
            barra = '💖'.repeat(preenchido) + '🖤'.repeat(10 - preenchido);

            return message.reply(
                `💘 **${user1.username} + ${user2.username}** = **${porcentagem}%**\n${barra}`
            );
        }

        // Porcentagem "gay" — brincadeira boba pedida por um membro
        if (message.content.startsWith('p!gay')) {
            const alvo = pegarAlvo(message);

            const seed = alvo.id + hojeStr();
            const porcentagem = seedNumero(seed, 0, 100);

            const preenchido = Math.round(porcentagem / 10);
            const barra = '🏳️‍🌈'.repeat(preenchido) + '⬛'.repeat(10 - preenchido);

            return message.reply(
                `🏳️‍🌈 **${alvo.username}** está **${porcentagem}%** hoje!\n${barra}\n_(é só brincadeira entre vocês, não é sério haha)_`
            );
        }

        // Fechar canal
        if (message.content === 'p!fecharcanal') {

            if (!message.guild || !message.member) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            if (
                !message.member.permissions.has(
                    PermissionsBitField.Flags.ManageChannels
                )
            ) {
                return message.reply('❌ Sem permissão.');
            }

            await message.channel.permissionOverwrites.edit(
                message.guild.roles.everyone,
                {
                    SendMessages: false
                }
            );

            return message.channel.send('🔒 Canal fechado.');
        }

        // Abrir canal
        if (message.content === 'p!abrircanal') {

            if (!message.guild || !message.member) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            if (
                !message.member.permissions.has(
                    PermissionsBitField.Flags.ManageChannels
                )
            ) {
                return message.reply('❌ Sem permissão.');
            }

            await message.channel.permissionOverwrites.edit(
                message.guild.roles.everyone,
                {
                    SendMessages: true
                }
            );

            return message.channel.send('🔓 Canal aberto.');
        }

        // ---------- Moderação ----------

        // Limpar mensagens
        if (message.content.startsWith('p!limpar')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            const partes = message.content.trim().split(/\s+/);
            let quantidade = parseInt(partes[1], 10);

            if (!Number.isInteger(quantidade) || quantidade < 1) {
                return message.reply('Use: p!limpar quantidade (1 a 100)');
            }

            quantidade = Math.min(quantidade, 100);

            const apagadas = await message.channel.bulkDelete(quantidade + 1, true);

            const aviso = await message.channel.send(
                `🧹 ${apagadas.size - 1} mensagens apagadas.`
            );
            setTimeout(() => aviso.delete().catch(() => {}), 4000);
            return;
        }

        // Purge member — apaga as mensagens de um membro em TODOS os canais do servidor
        if (message.content.startsWith('p!purgemember')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageGuild)) {
                return message.reply('❌ Sem permissão.');
            }

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            const alvo = message.mentions.users.first();
            const idAlvo = alvo?.id || message.content.trim().split(/\s+/)[1];

            if (!idAlvo) {
                return message.reply('Use: p!purgemember @membro  (ou p!purgemember ID_do_usuário)');
            }

            const aviso = await message.reply(
                `🔎 Procurando mensagens de <@${idAlvo}> em todos os canais... isso pode demorar um pouco.`
            );

            let totalApagadas = 0;
            let canaisComErro = 0;
            const QUATORZE_DIAS_MS = 14 * 24 * 60 * 60 * 1000;

            const canais = message.guild.channels.cache.filter(
                c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement
            );

            for (const [, canal] of canais) {
                try {
                    const permissoesBot = canal.permissionsFor(message.guild.members.me);
                    if (
                        !permissoesBot?.has(PermissionsBitField.Flags.ViewChannel) ||
                        !permissoesBot?.has(PermissionsBitField.Flags.ManageMessages) ||
                        !permissoesBot?.has(PermissionsBitField.Flags.ReadMessageHistory)
                    ) {
                        continue;
                    }

                    let ultimoId;
                    let continuar = true;

                    while (continuar) {
                        const opcoes = { limit: 100 };
                        if (ultimoId) opcoes.before = ultimoId;

                        const mensagens = await canal.messages.fetch(opcoes);
                        if (mensagens.size === 0) break;

                        ultimoId = mensagens.last().id;

                        const doMembro = mensagens.filter(m => m.author.id === idAlvo);

                        if (doMembro.size > 0) {
                            const recentes = doMembro.filter(m => Date.now() - m.createdTimestamp < QUATORZE_DIAS_MS);
                            const antigas = doMembro.filter(m => Date.now() - m.createdTimestamp >= QUATORZE_DIAS_MS);

                            if (recentes.size > 0) {
                                try {
                                    const apagadas = await canal.bulkDelete(recentes, true);
                                    totalApagadas += apagadas.size;
                                } catch (erro) {
                                    for (const [, msg] of recentes) {
                                        await msg.delete().catch(() => {});
                                        totalApagadas++;
                                    }
                                }
                            }

                            for (const [, msg] of antigas) {
                                await msg.delete().catch(() => {});
                                totalApagadas++;
                            }
                        }

                        if (mensagens.size < 100) continuar = false;
                    }
                } catch (erro) {
                    canaisComErro++;
                    console.error(`Erro ao apagar mensagens no canal ${canal.name}:`, erro);
                }
            }

            return aviso.edit(
                `✅ Concluído! **${totalApagadas}** mensagens de <@${idAlvo}> apagadas em todos os canais de texto` +
                (canaisComErro > 0 ? ` (${canaisComErro} canal(is) com erro ou sem permissão).` : '.')
            );
        }



        // Slowmode
        if (message.content.startsWith('p!slowmode')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageChannels)) {
                return message.reply('❌ Sem permissão.');
            }

            const partes = message.content.trim().split(/\s+/);
            const segundos = parseInt(partes[1], 10);

            if (!Number.isInteger(segundos) || segundos < 0 || segundos > 21600) {
                return message.reply('Use: p!slowmode segundos (0 a 21600, 0 desativa)');
            }

            await message.channel.setRateLimitPerUser(segundos);

            return message.reply(
                segundos === 0
                    ? '⏱️ Slowmode desativado.'
                    : `⏱️ Slowmode definido para ${segundos}s.`
            );
        }

        // Trancar canal (mesmo comportamento do fecharcanal)
        if (message.content === 'p!trancar') {

            if (!message.guild || !message.member) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            if (!temPermissao(message, PermissionsBitField.Flags.ManageChannels)) {
                return message.reply('❌ Sem permissão.');
            }

            await message.channel.permissionOverwrites.edit(
                message.guild.roles.everyone,
                { SendMessages: false }
            );

            return message.channel.send('🔒 Canal trancado.');
        }

        // Destrancar canal (mesmo comportamento do abrircanal)
        if (message.content === 'p!destrancar') {

            if (!message.guild || !message.member) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            if (!temPermissao(message, PermissionsBitField.Flags.ManageChannels)) {
                return message.reply('❌ Sem permissão.');
            }

            await message.channel.permissionOverwrites.edit(
                message.guild.roles.everyone,
                { SendMessages: true }
            );

            return message.channel.send('🔓 Canal destrancado.');
        }

        // Falar em outro canal
        if (message.content.startsWith('p!falar ')) {

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            const partes = message.content.slice(8).trim().split(/\s+/);
            const idCanal = partes.shift();
            const texto = partes.join(' ').trim();

            if (!idCanal || !texto) {
                return message.reply('Use: p!falar id_do_canal mensagem');
            }

            let canal;
            try {
                canal = await message.guild.channels.fetch(idCanal);
            } catch (_) {
                canal = null;
            }

            if (!canal || !canal.isTextBased()) {
                return message.reply('❌ Não achei um canal de texto com esse ID nesse servidor.');
            }

            try {
                await canal.send(texto);
            } catch (erro) {
                console.error('Erro ao enviar mensagem com p!falar:', erro);
                return message.reply('❌ Não consegui enviar a mensagem nesse canal (confere minhas permissões lá).');
            }

            message.delete().catch(() => {});

            const confirmacao = await message.channel.send(`✅ Mensagem enviada em <#${canal.id}>.`);
            setTimeout(() => confirmacao.delete().catch(() => {}), 4000);
            return;
        }

        // Aviso
        if (message.content.startsWith('p!aviso')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ModerateMembers)) {
                return message.reply('❌ Sem permissão.');
            }

            const alvo = message.mentions.users.first();

            if (!alvo) {
                return message.reply('Use: p!aviso @user motivo');
            }

            const motivo = message.content
                .split(/\s+/)
                .slice(2)
                .join(' ')
                .trim() || 'Sem motivo especificado';

            const listaAtual = avisos.get(alvo.id) || [];
            listaAtual.push({ motivo, autorId: message.author.id, data: Date.now() });
            avisos.set(alvo.id, listaAtual);
            salvarDados();

            alvo.send(
                `⚠️ Você recebeu um aviso em **${message.guild.name}**.\nMotivo: ${motivo}`
            ).catch(() => {});

            return message.channel.send(
                `⚠️ **${alvo.username}** foi avisado(a). Motivo: ${motivo}\nTotal de avisos: ${listaAtual.length}`
            );
        }

        // Histórico de avisos de um membro
        if (message.content.startsWith('p!warnings')) {
            const alvo = message.mentions.users.first() || message.author;

            // só precisa de permissão pra ver o histórico de OUTRA pessoa
            if (alvo.id !== message.author.id && !temPermissao(message, PermissionsBitField.Flags.ModerateMembers)) {
                return message.reply('❌ Sem permissão.');
            }

            const lista = avisos.get(alvo.id) || [];

            if (lista.length === 0) {
                return message.reply(`✅ **${alvo.username}** não tem nenhum aviso registrado.`);
            }

            const ultimos = lista.slice(-10);
            const primeiroNumero = lista.length - ultimos.length + 1;

            const linhas = ultimos.map((aviso, i) => {
                const dataTexto = aviso.data ? `<t:${Math.floor(aviso.data / 1000)}:d>` : 'data desconhecida';
                return `**${primeiroNumero + i}.** ${aviso.motivo} _(${dataTexto})_`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`⚠️ Histórico de avisos — ${alvo.username}`)
                .setColor(0xFFA500)
                .setDescription(linhas)
                .setFooter({
                    text: `Total: ${lista.length} aviso(s)` + (lista.length > 10 ? ' (mostrando os 10 mais recentes)' : '')
                });

            return message.channel.send({ embeds: [embed] });
        }

        // Banir
        if (message.content.startsWith('p!ban')) {

            if (!temPermissao(message, PermissionsBitField.Flags.BanMembers)) {
                return message.reply('❌ Sem permissão.');
            }

            const alvo = message.mentions.users.first();

            if (!alvo) {
                return message.reply('Use: p!ban @user motivo(opcional)');
            }

            const motivo = message.content.split(/\s+/).slice(2).join(' ').trim() || 'Sem motivo especificado';

            const membroAlvo = await message.guild.members.fetch(alvo.id).catch(() => null);
            if (membroAlvo && !membroAlvo.bannable) {
                return message.reply('❌ Não consigo banir essa pessoa (cargo dela é igual ou maior que o meu, ou é o dono do servidor).');
            }

            alvo.send(`🔨 Você foi banido(a) de **${message.guild.name}**.\nMotivo: ${motivo}`).catch(() => {});

            await message.guild.members.ban(alvo.id, { reason: motivo });

            return message.channel.send(`🔨 **${alvo.username}** foi banido(a). Motivo: ${motivo}`);
        }

        // Desbanir
        if (message.content.startsWith('p!unban')) {

            if (!temPermissao(message, PermissionsBitField.Flags.BanMembers)) {
                return message.reply('❌ Sem permissão.');
            }

            const idAlvo = message.content.trim().split(/\s+/)[1];

            if (!idAlvo) {
                return message.reply('Use: p!unban ID_do_usuário');
            }

            try {
                await message.guild.members.unban(idAlvo);
                return message.channel.send(`✅ Usuário <@${idAlvo}> foi desbanido(a).`);
            } catch (erro) {
                return message.reply('❌ Não consegui desbanir esse ID (confere se está certo e se a pessoa está mesmo banida).');
            }
        }

        // Mutar (timeout nativo do Discord) por um tempo determinado
        if (message.content.startsWith('p!mute')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ModerateMembers)) {
                return message.reply('❌ Sem permissão.');
            }

            const alvo = message.mentions.users.first();
            const partes = message.content.trim().split(/\s+/);
            const duracaoStr = partes[2];
            const motivo = partes.slice(3).join(' ').trim() || 'Sem motivo especificado';

            if (!alvo || !duracaoStr) {
                return message.reply('Use: p!mute @user duração motivo(opcional)\nExemplo: p!mute @user 10m spam');
            }

            const duracaoMs = parseDuracaoMs(duracaoStr);

            if (!duracaoMs) {
                return message.reply('Duração inválida. Use algo como 30s, 10m, 2h ou 1d.');
            }

            if (duracaoMs > 28 * 24 * 60 * 60 * 1000) {
                return message.reply('❌ O Discord só permite mutar por no máximo 28 dias.');
            }

            const membroAlvo = await message.guild.members.fetch(alvo.id).catch(() => null);

            if (!membroAlvo) {
                return message.reply('❌ Não encontrei esse membro no servidor.');
            }

            if (!membroAlvo.moderatable) {
                return message.reply('❌ Não consigo mutar essa pessoa (cargo dela é igual ou maior que o meu).');
            }

            await membroAlvo.timeout(duracaoMs, motivo);

            return message.channel.send(
                `🔇 **${alvo.username}** foi mutado(a) por ${duracaoStr}. Motivo: ${motivo}`
            );
        }

        // Desmutar (remove o timeout antes do tempo acabar)
        if (message.content.startsWith('p!desmutar') || message.content.startsWith('p!unmute')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ModerateMembers)) {
                return message.reply('❌ Sem permissão.');
            }

            const alvo = message.mentions.users.first();

            if (!alvo) {
                return message.reply('Use: p!desmutar @user');
            }

            const membroAlvo = await message.guild.members.fetch(alvo.id).catch(() => null);

            if (!membroAlvo) {
                return message.reply('❌ Não encontrei esse membro no servidor.');
            }

            await membroAlvo.timeout(null).catch(() => {});

            return message.channel.send(`🔊 **${alvo.username}** foi desmutado(a).`);
        }

        // Info do usuário
        if (message.content.startsWith('p!userinfo')) {

            const alvo = pegarAlvo(message);
            const membro = message.guild
                ? await message.guild.members.fetch(alvo.id).catch(() => null)
                : null;

            const embed = new EmbedBuilder()
                .setTitle(`👤 ${alvo.username}`)
                .setThumbnail(alvo.displayAvatarURL({ size: 256 }))
                .addFields(
                    { name: 'ID', value: alvo.id, inline: true },
                    { name: 'Conta criada em', value: `<t:${Math.floor(alvo.createdTimestamp / 1000)}:D>`, inline: true }
                )
                .setColor(0x5865F2);

            if (membro && membro.joinedTimestamp) {
                embed.addFields({
                    name: 'Entrou no servidor em',
                    value: `<t:${Math.floor(membro.joinedTimestamp / 1000)}:D>`,
                    inline: true
                });
            }

            if (membro) {
                const cargos = membro.roles.cache
                    .filter(r => r.id !== message.guild.id)
                    .map(r => r.toString());

                embed.addFields({
                    name: `Cargos (${cargos.length})`,
                    value: cargos.length ? cargos.join(', ').slice(0, 1000) : 'Nenhum'
                });
            }

            return message.reply({ embeds: [embed] });
        }

        // Info do servidor
        if (message.content === 'p!serverinfo') {

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            const guild = message.guild;
            await guild.members.fetch().catch(() => {});

            const totalMembros = guild.memberCount;
            const bots = guild.members.cache.filter(m => m.user.bot).size;
            const humanos = totalMembros - bots;

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${guild.name}`)
                .setThumbnail(guild.iconURL({ size: 256 }))
                .addFields(
                    { name: 'Membros', value: `${totalMembros}`, inline: true },
                    { name: 'Humanos', value: `${humanos}`, inline: true },
                    { name: 'Bots', value: `${bots}`, inline: true },
                    { name: 'Cargos', value: `${guild.roles.cache.size}`, inline: true },
                    { name: 'Canais', value: `${guild.channels.cache.size}`, inline: true },
                    { name: 'Criado em', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true }
                )
                .setColor(0x5865F2);

            return message.reply({ embeds: [embed] });
        }

        // ---------- Automação ----------

        // Embed personalizado
        if (message.content.startsWith('p!embed')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            const canalMencionado = message.mentions.channels.first();

            if (!canalMencionado) {
                return message.reply(
                    'Use: p!embed #canal | Título | Descrição\nExemplo: p!embed #avisos | Bem-vindos! | Leiam as regras antes de postar.'
                );
            }

            const semComando = message.content.replace('p!embed', '').trim();
            const partes = semComando.split('|').map(p => p.trim());

            const titulo = partes[1] || '';
            const descricao = partes[2] || '';

            if (!titulo && !descricao) {
                return message.reply(
                    'Use: p!embed #canal | Título | Descrição'
                );
            }

            const embed = new EmbedBuilder()
                .setColor(0x5865F2);

            if (titulo) embed.setTitle(titulo);
            if (descricao) embed.setDescription(descricao);

            await canalMencionado.send({ embeds: [embed] });
            return message.reply(`✅ Embed enviado em ${canalMencionado}.`);
        }

        // Enquete
        if (message.content.startsWith('p!enquete ')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            const partes = message.content
                .slice(10)
                .split('|')
                .map(p => p.trim())
                .filter(Boolean);

            if (partes.length < 2) {
                return message.reply(
                    'Use: p!enquete pergunta | opção1 | opção2 (até 10 opções)'
                );
            }

            const pergunta = partes[0];
            const opcoes = partes.slice(1, 11);

            const descricao = opcoes
                .map((opcao, i) => `${NUMEROS_EMOJI[i]} ${opcao}`)
                .join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${pergunta}`)
                .setDescription(descricao)
                .setColor(0x57F287)
                .setFooter({ text: `Enquete criada por ${message.author.username}` });

            const enquete = await message.channel.send({ embeds: [embed] });

            for (let i = 0; i < opcoes.length; i++) {
                await enquete.react(NUMEROS_EMOJI[i]);
            }

            return message.delete().catch(() => {});
        }

        // Sugestão
        if (message.content.startsWith('p!sugestao ')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            const texto = message.content.slice(11).trim();

            if (!texto) {
                return message.reply('Use: p!sugestao sua ideia aqui');
            }

            const embed = new EmbedBuilder()
                .setTitle('💡 Nova sugestão')
                .setDescription(texto)
                .setColor(0xFEE75C)
                .setFooter({ text: `Sugerido por ${message.author.username}` })
                .setThumbnail(message.author.displayAvatarURL());

            const sugestao = await message.channel.send({ embeds: [embed] });
            await sugestao.react('✅');
            await sugestao.react('❌');

            return message.delete().catch(() => {});
        }

        // ---------- Coisas diferentes ----------

        // Avatar
        if (message.content.startsWith('p!avatar')) {
            const alvo = pegarAlvo(message);

            const embed = new EmbedBuilder()
                .setTitle(`🖼️ Avatar de ${alvo.username}`)
                .setImage(alvo.displayAvatarURL({ size: 512 }))
                .setColor(0x5865F2);

            return message.reply({ embeds: [embed] });
        }

        // Contador
        if (message.content === 'p!contador') {

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            await message.guild.members.fetch().catch(() => {});

            const total = message.guild.memberCount;
            const bots = message.guild.members.cache.filter(m => m.user.bot).size;
            const humanos = total - bots;

            return message.reply(
                `📊 **Contador de membros**\nTotal: ${total}\nHumanos: ${humanos}\nBots: ${bots}`
            );
        }

        // Fato curioso
        if (message.content === 'p!fato') {
            return message.reply(`🧠 **Você sabia?** ${fatoAleatorio()}`);
        }

        // Dica de Discord
        if (message.content === 'p!dica') {
            return message.reply(`💡 **Dica:** ${dicaDiscord()}`);
        }

        // Gato aleatório
        if (message.content === 'p!gato') {
            try {
                const resposta = await fetch('https://api.thecatapi.com/v1/images/search', {
                    headers: { 'x-api-key': process.env.CAT_PIMBOLA }
                });

                if (!resposta.ok) {
                    throw new Error(`Cat API retornou status ${resposta.status}`);
                }

                const dados = await resposta.json();
                const urlGato = dados[0]?.url;

                if (!urlGato) {
                    return message.reply('❌ Não achei nenhum gato agora 😿');
                }

                const embedGato = new EmbedBuilder()
                    .setTitle('🐱 Miau!')
                    .setImage(urlGato)
                    .setColor(0xEB459E);

                return message.reply({ embeds: [embedGato] });
            } catch (erro) {
                console.error('Erro ao buscar gato:', erro);
                return message.reply('❌ Deu ruim ao buscar o gato 😿');
            }
        }

        // Sorteio avançado
        if (message.content.startsWith('p!sorteio ')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            const partes = message.content
                .slice(10)
                .split('|')
                .map(p => p.trim())
                .filter(Boolean);

            if (partes.length < 2) {
                return message.reply(
                    'Use: p!sorteio duração | prêmio | vencedores(opcional)\n' +
                    'Exemplo: p!sorteio 60s | Nitro | 2'
                );
            }

            const [duracaoStr, premio, vencedoresStr] = partes;
            const numVencedores = Math.max(1, parseInt(vencedoresStr, 10) || 1);

            const match = duracaoStr.match(/^(\d+)\s*(s|m|h|d)$/i);
            if (!match) {
                return message.reply('Duração inválida. Use algo como 30s, 10m, 2h ou 1d.');
            }

            const multiplicadores = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
            const duracaoMs = parseInt(match[1], 10) * multiplicadores[match[2].toLowerCase()];

            if (duracaoMs > 21600000) {
                return message.reply('❌ Duração máxima de 6 horas (limite pra evitar sorteio travado se o bot reiniciar).');
            }

            const terminaEm = Date.now() + duracaoMs;

            const embed = new EmbedBuilder()
                .setTitle('🎉 SORTEIO 🎉')
                .setDescription(
                    `**Prêmio:** ${premio}\n` +
                    `Reaja com 🎉 pra participar!\n` +
                    `Termina em: <t:${Math.floor(terminaEm / 1000)}:R>\n` +
                    `Vencedores: ${numVencedores}`
                )
                .setColor(0xEB459E)
                .setFooter({ text: `Sorteio criado por ${message.author.username}` });

            const msgSorteio = await message.channel.send({ embeds: [embed] });
            await msgSorteio.react('🎉');

            setTimeout(async () => {
                try {
                    const msgAtualizada = await msgSorteio.fetch();
                    const reacao = msgAtualizada.reactions.cache.get('🎉');
                    const usuarios = reacao
                        ? (await reacao.users.fetch()).filter(u => !u.bot)
                        : new Map();

                    const participantes = [...usuarios.values()];

                    if (participantes.length === 0) {
                        return msgSorteio.reply('😢 Ninguém participou do sorteio.');
                    }

                    const embaralhados = participantes.sort(() => Math.random() - 0.5);
                    const vencedores = embaralhados.slice(0, numVencedores);

                    return msgSorteio.reply(
                        `🎉 Parabéns ${vencedores.map(v => `<@${v.id}>`).join(', ')}! Vocês ganharam **${premio}**!`
                    );
                } catch (erro) {
                    console.error('Erro ao finalizar sorteio:', erro);
                }
            }, duracaoMs);

            return;
        }

        // Contador regressivo
        if (message.content.startsWith('p!contadorregressivo ')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            const partes = message.content.slice(22).split('|').map(p => p.trim());
            const duracaoStr = partes[0];
            const evento = partes[1] || 'Evento';

            const match = duracaoStr.match(/^(\d+)\s*(s|m|h|d)$/i);
            if (!match) {
                return message.reply(
                    'Use: p!contadorregressivo duração | nome do evento\nExemplo: p!contadorregressivo 2h | Sessão de RP'
                );
            }

            const multiplicadores = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
            const alvoMs = Date.now() + parseInt(match[1], 10) * multiplicadores[match[2].toLowerCase()];

            const embed = new EmbedBuilder()
                .setTitle(`⏳ ${evento}`)
                .setDescription(`Faltam: <t:${Math.floor(alvoMs / 1000)}:R>\n(<t:${Math.floor(alvoMs / 1000)}:F>)`)
                .setColor(0x5865F2);

            return message.channel.send({ embeds: [embed] });
        }

        // Sessão — agenda as chamadas automáticas (1/3, 2/3, 3/3) pra um horário (GMT-3)
        // Cancelar a sessão agendada
        if (message.content === 'p!sessão cancelar' || message.content === 'p!sessao cancelar') {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            if (!sessoesAtivas.has(message.guild.id)) {
                return message.reply('❌ Não tem nenhuma sessão agendada nesse servidor.');
            }

            sessoesAtivas.delete(message.guild.id);
            salvarDados();

            return message.reply('🗑️ Sessão cancelada. Nenhuma chamada vai ser enviada.');
        }

        // Ver status da sessão agendada
        if (message.content === 'p!sessão status' || message.content === 'p!sessao status') {

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            const sessao = sessoesAtivas.get(message.guild.id);

            if (!sessao) {
                return message.reply('📭 Não tem nenhuma sessão agendada nesse servidor no momento.');
            }

            let etapa;
            if (!sessao.enviouChamada1) etapa = 'Aguardando a chamada 1/3';
            else if (!sessao.enviouChamada2) etapa = 'Chamada 1/3 já enviada — aguardando a 2/3';
            else if (!sessao.enviouChamada3) etapa = 'Chamada 2/3 já enviada — aguardando a 3/3 (fechamento)';
            else etapa = 'Concluída (aguardando limpeza)';

            return message.reply(
                `📋 **Status da sessão**\n` +
                `Horário: ${sessao.horario} (GMT-3) — <t:${Math.floor(sessao.alvoMs / 1000)}:R>\n` +
                `Etapa atual: ${etapa}\n` +
                `Presentes até agora: ${sessao.presentes.length}`
            );
        }

        // Ver quantas faltas seguidas alguém tem nas chamadas de sessão
        if (message.content.startsWith('p!faltas')) {
            const alvo = message.mentions.users.first() || message.author;
            const total = faltasSessao[alvo.id] || 0;

            return message.reply(`📉 **${alvo.username}** está com **${total}/3** faltas seguidas nas chamadas de sessão.`);
        }

        if (message.content.startsWith('p!sessão ') || message.content.startsWith('p!sessao ')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            const prefixo = message.content.startsWith('p!sessão ') ? 'p!sessão '.length : 'p!sessao '.length;
            const horarioStr = message.content.slice(prefixo).trim();

            if (!/^\d{1,2}:\d{2}$/.test(horarioStr)) {
                return message.reply(
                    'Use: p!sessão HH:MM (horário no fuso GMT-3)\nExemplo: p!sessão 15:00'
                );
            }

            const alvoMs = proximoHorarioGMT3(horarioStr);

            if (!alvoMs) {
                return message.reply(
                    '❌ Esse horário já passou hoje (fuso GMT-3). Use um horário ainda não chegou, ou marque de novo mais perto do horário desejado.'
                );
            }

            if (sessoesAtivas.has(message.guild.id)) {
                return message.reply('⚠️ Já tem uma sessão agendada nesse servidor. Espere ela terminar (ou o 3/3 ser enviado) antes de marcar outra.');
            }

            const chamada1Em = alvoMs - 20 * 60 * 1000;
            const chamada2Em = alvoMs - 10 * 60 * 1000;

            sessoesAtivas.set(message.guild.id, {
                guildId: message.guild.id,
                canalId: CANAL_CHAMADAS_SESSAO,
                horario: horarioStr,
                alvoMs,
                chamada1Em,
                chamada2Em,
                enviouChamada1: false,
                enviouChamada2: false,
                enviouChamada3: false,
                janelaAberta: false,
                presentes: []
            });
            salvarDados();

            return message.reply(
                `📢 Sessão marcada para ${horarioStr} (GMT-3) — daqui a <t:${Math.floor(alvoMs / 1000)}:R>.\n` +
                `Chamada 1/3 às ${formatarHoraGMT3(chamada1Em)}, chamada 2/3 às ${formatarHoraGMT3(chamada2Em)} (GMT-3), e 3/3 no horário marcado — tudo em <#${CANAL_CHAMADAS_SESSAO}>.\n` +
                `Quem disser **Eu** lá durante esse período marca presença. 3 faltas seguidas = aviso em <#${CANAL_AVISO_PRESENCA}>.`
            );
        }

        // Cápsula do tempo
        if (message.content.startsWith('p!capsula ')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            const partes = message.content.slice(10).split('|').map(p => p.trim());
            const dataStr = partes[0];
            const texto = partes.slice(1).join('|').trim();

            if (!texto) {
                return message.reply(
                    'Use: p!capsula AAAA-MM-DD | mensagem\nExemplo: p!capsula 2026-12-25 | Feliz Natal, pessoal!'
                );
            }

            const dataAlvo = new Date(dataStr);

            if (isNaN(dataAlvo.getTime()) || dataAlvo.getTime() <= Date.now()) {
                return message.reply('❌ Data inválida ou já passou. Use o formato AAAA-MM-DD.');
            }

            capsulasPendentes.push({
                desbloqueiaEm: dataAlvo.getTime(),
                canalId: message.channel.id,
                autorTag: message.author.username,
                texto
            });
            salvarDados();

            return message.reply(
                `📦 Cápsula guardada! Ela vai abrir em <t:${Math.floor(dataAlvo.getTime() / 1000)}:F>.`
            );
        }

        // Mural de avisos
        if (message.content.startsWith('p!mural')) {

            const resto = message.content.slice(7).trim();
            const [subcomando, ...restoArr] = resto.split(/\s+/);
            const argumento = restoArr.join(' ').trim();

            async function renderizarMural(canal) {
                const dados = murais.get(canal.id) || { messageId: null, itens: [] };

                const embed = new EmbedBuilder()
                    .setTitle('📌 Mural de avisos')
                    .setDescription(
                        dados.itens.length
                            ? dados.itens.map((item, i) => `**${i + 1}.** ${item}`).join('\n')
                            : 'Nenhum aviso no momento.'
                    )
                    .setColor(0xFEE75C);

                if (dados.messageId) {
                    try {
                        const msgExistente = await canal.messages.fetch(dados.messageId);
                        await msgExistente.edit({ embeds: [embed] });
                        return;
                    } catch (_) {
                        // mensagem antiga não existe mais, cria uma nova abaixo
                    }
                }

                const novaMsg = await canal.send({ embeds: [embed] });
                await novaMsg.pin().catch(() => {});
                murais.set(canal.id, { messageId: novaMsg.id, itens: dados.itens });
                salvarDados();
            }

            if (subcomando === 'add') {

                if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                    return message.reply('❌ Sem permissão.');
                }

                if (!argumento) {
                    return message.reply('Use: p!mural add texto do aviso');
                }

                const dados = murais.get(message.channel.id) || { messageId: null, itens: [] };
                dados.itens.push(argumento);
                murais.set(message.channel.id, dados);
                salvarDados();

                await renderizarMural(message.channel);
                return message.delete().catch(() => {});
            }

            if (subcomando === 'remover') {

                if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                    return message.reply('❌ Sem permissão.');
                }

                const indice = parseInt(argumento, 10) - 1;
                const dados = murais.get(message.channel.id);

                if (!dados || !dados.itens[indice]) {
                    return message.reply('Use: p!mural remover número (veja os números no mural)');
                }

                dados.itens.splice(indice, 1);
                murais.set(message.channel.id, dados);
                salvarDados();

                await renderizarMural(message.channel);
                return message.delete().catch(() => {});
            }

            // sem subcomando = só mostra/cria o mural
            await renderizarMural(message.channel);
            return message.delete().catch(() => {});
        }

        // Votação completa
        if (message.content.startsWith('p!votacao')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            if (message.content === 'p!votacao fechar') {

                const referencia = message.reference
                    ? await message.fetchReference().catch(() => null)
                    : null;

                if (!referencia || !votacoesAtivas.has(referencia.id)) {
                    return message.reply(
                        'Pra fechar, responda (reply) à mensagem da votação com: p!votacao fechar'
                    );
                }

                const info = votacoesAtivas.get(referencia.id);
                const msgAtualizada = await referencia.fetch();

                const resultados = info.opcoes.map((opcao, i) => {
                    const reacao = msgAtualizada.reactions.cache.get(NUMEROS_EMOJI[i]);
                    const votos = reacao ? Math.max(0, reacao.count - 1) : 0;
                    return { opcao, votos };
                }).sort((a, b) => b.votos - a.votos);

                const embed = new EmbedBuilder()
                    .setTitle(`📊 Resultado: ${info.pergunta}`)
                    .setDescription(
                        resultados.map(r => `**${r.opcao}** — ${r.votos} voto(s)`).join('\n')
                    )
                    .setColor(0x57F287);

                votacoesAtivas.delete(referencia.id);
                salvarDados();
                return message.channel.send({ embeds: [embed] });
            }

            if (!message.content.startsWith('p!votacao ')) {
                return message.reply(
                    'Use: p!votacao pergunta | opção1 | opção2\n' +
                    'Pra fechar: responda a mensagem da votação com p!votacao fechar'
                );
            }

            const partes = message.content
                .slice(10)
                .split('|')
                .map(p => p.trim())
                .filter(Boolean);

            if (partes.length < 2) {
                return message.reply('Use: p!votacao pergunta | opção1 | opção2 (até 10 opções)');
            }

            const pergunta = partes[0];
            const opcoes = partes.slice(1, 11);

            const embed = new EmbedBuilder()
                .setTitle(`🗳️ ${pergunta}`)
                .setDescription(opcoes.map((o, i) => `${NUMEROS_EMOJI[i]} ${o}`).join('\n'))
                .setColor(0x57F287)
                .setFooter({ text: 'Reaja pra votar • um staff pode fechar com p!votacao fechar (em reply)' });

            const msgVotacao = await message.channel.send({ embeds: [embed] });

            for (let i = 0; i < opcoes.length; i++) {
                await msgVotacao.react(NUMEROS_EMOJI[i]);
            }

            votacoesAtivas.set(msgVotacao.id, { pergunta, opcoes });
            salvarDados();
            return;
        }

        // Changelog do servidor
        if (message.content.startsWith('p!changelog')) {

            const resto = message.content.slice(11).trim();

            if (resto.startsWith('add ')) {

                if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                    return message.reply('❌ Sem permissão.');
                }

                const texto = resto.slice(4).trim();

                if (!texto) {
                    return message.reply('Use: p!changelog add texto da atualização');
                }

                const lista = changelogs.get(message.guild.id) || [];
                lista.unshift({
                    data: new Date().toISOString(),
                    autor: message.author.username,
                    texto
                });
                changelogs.set(message.guild.id, lista);
                salvarDados();

                return message.reply('📝 Atualização registrada no changelog.');
            }

            const lista = changelogs.get(message.guild?.id) || [];

            const embed = new EmbedBuilder()
                .setTitle('📝 Changelog do servidor')
                .setDescription(
                    lista.length
                        ? lista.slice(0, 10).map(item =>
                            `**${item.data.slice(0, 10)}** — ${item.texto} _(${item.autor})_`
                        ).join('\n')
                        : 'Nenhuma atualização registrada ainda.'
                )
                .setColor(0x5865F2);

            return message.reply({ embeds: [embed] });
        }

        // Estatísticas completas
        if (message.content === 'p!estatisticas') {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            const guild = message.guild;
            await guild.members.fetch().catch(() => {});

            const total = guild.memberCount;
            const bots = guild.members.cache.filter(m => m.user.bot).size;
            const humanos = total - bots;

            const textos = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
            const voz = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
            const categorias = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size;

            const embed = new EmbedBuilder()
                .setTitle(`📊 Painel de estatísticas — ${guild.name}`)
                .setThumbnail(guild.iconURL({ size: 256 }))
                .addFields(
                    { name: 'Membros', value: `${total} (👤 ${humanos} / 🤖 ${bots})`, inline: false },
                    { name: 'Canais de texto', value: `${textos}`, inline: true },
                    { name: 'Canais de voz', value: `${voz}`, inline: true },
                    { name: 'Categorias', value: `${categorias}`, inline: true },
                    { name: 'Cargos', value: `${guild.roles.cache.size}`, inline: true },
                    { name: 'Emojis', value: `${guild.emojis.cache.size}`, inline: true },
                    { name: 'Nível de boost', value: `${guild.premiumTier} (${guild.premiumSubscriptionCount || 0} boosts)`, inline: true },
                    { name: 'Dono', value: `<@${guild.ownerId}>`, inline: true },
                    { name: 'Criado em', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true }
                )
                .setColor(0x5865F2);

            return message.reply({ embeds: [embed] });
        }

        // Snapshot do servidor
        if (message.content.startsWith('p!snapshot')) {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ Sem permissão.');
            }

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            const sub = message.content.slice(10).trim();
            const guild = message.guild;

            if (sub === 'salvar' || sub === '') {
                await guild.members.fetch().catch(() => {});

                const snap = {
                    data: new Date().toISOString(),
                    cargos: guild.roles.cache.map(r => r.name),
                    canais: guild.channels.cache.map(c => c.name),
                    membros: guild.memberCount
                };

                const lista = snapshots.get(guild.id) || [];
                lista.push(snap);
                snapshots.set(guild.id, lista);
                salvarDados();

                return message.reply(
                    `📸 Snapshot salvo! (${snap.cargos.length} cargos, ${snap.canais.length} canais, ${snap.membros} membros)`
                );
            }

            if (sub === 'comparar') {
                const lista = snapshots.get(guild.id) || [];

                if (lista.length < 2) {
                    return message.reply('❌ Preciso de pelo menos 2 snapshots salvos pra comparar. Use p!snapshot salvar primeiro.');
                }

                const anterior = lista[lista.length - 2];
                const atual = lista[lista.length - 1];

                const cargosAdicionados = atual.cargos.filter(c => !anterior.cargos.includes(c));
                const cargosRemovidos = anterior.cargos.filter(c => !atual.cargos.includes(c));
                const canaisAdicionados = atual.canais.filter(c => !anterior.canais.includes(c));
                const canaisRemovidos = anterior.canais.filter(c => !atual.canais.includes(c));

                const embed = new EmbedBuilder()
                    .setTitle('📸 Comparação de snapshots')
                    .addFields(
                        { name: 'Membros', value: `${anterior.membros} → ${atual.membros} (${atual.membros - anterior.membros >= 0 ? '+' : ''}${atual.membros - anterior.membros})` },
                        { name: '➕ Cargos adicionados', value: cargosAdicionados.length ? cargosAdicionados.join(', ') : 'Nenhum' },
                        { name: '➖ Cargos removidos', value: cargosRemovidos.length ? cargosRemovidos.join(', ') : 'Nenhum' },
                        { name: '➕ Canais adicionados', value: canaisAdicionados.length ? canaisAdicionados.join(', ') : 'Nenhum' },
                        { name: '➖ Canais removidos', value: canaisRemovidos.length ? canaisRemovidos.join(', ') : 'Nenhum' }
                    )
                    .setColor(0x5865F2);

                return message.reply({ embeds: [embed] });
            }

            return message.reply('Use: p!snapshot salvar  ou  p!snapshot comparar');
        }

        // Nuke — recria o canal do zero (limpa qualquer quantidade de mensagens)
        if (message.content === 'p!nuke') {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageChannels)) {
                return message.reply('❌ Sem permissão.');
            }

            if (!message.guild || message.channel.type !== ChannelType.GuildText) {
                return message.reply('❌ Esse comando só funciona em canais de texto de um servidor.');
            }

            const nomeOriginal = message.channel.name;
            const posicao = message.channel.position;

            const novoCanal = await message.channel.clone();
            await novoCanal.setPosition(posicao).catch(() => {});
            await message.channel.delete().catch(() => {});

            return novoCanal.send(`💥 **${nomeOriginal}** foi nukado e recriado do zero!`);
        }

        // Lockdown — tranca TODOS os canais de texto do servidor
        if (message.content === 'p!lockdown') {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageChannels)) {
                return message.reply('❌ Sem permissão.');
            }

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            const canaisTexto = message.guild.channels.cache.filter(
                c => c.type === ChannelType.GuildText
            );

            let sucesso = 0;

            for (const canal of canaisTexto.values()) {
                try {
                    await canal.permissionOverwrites.edit(message.guild.roles.everyone, {
                        SendMessages: false
                    });
                    sucesso++;
                } catch (_) {
                    // sem permissão nesse canal específico, pula pro próximo
                }
            }

            return message.reply(`🔒 Lockdown ativado em ${sucesso}/${canaisTexto.size} canais.`);
        }

        // Openup — destranca TODOS os canais de texto do servidor
        if (message.content === 'p!openup') {

            if (!temPermissao(message, PermissionsBitField.Flags.ManageChannels)) {
                return message.reply('❌ Sem permissão.');
            }

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            const canaisTexto = message.guild.channels.cache.filter(
                c => c.type === ChannelType.GuildText
            );

            let sucesso = 0;

            for (const canal of canaisTexto.values()) {
                try {
                    await canal.permissionOverwrites.edit(message.guild.roles.everyone, {
                        SendMessages: true
                    });
                    sucesso++;
                } catch (_) {
                    // sem permissão nesse canal específico, pula pro próximo
                }
            }

            return message.reply(`🔓 ${sucesso}/${canaisTexto.size} canais destrancados.`);
        }

        // ---------- Música ----------

        // Tocar
        if (message.content.startsWith('p!tocar ')) {

            if (!message.guild) {
                return message.reply('❌ Esse comando só funciona dentro de um servidor.');
            }

            if (!message.member.voice.channel) {
                return message.reply('❌ Entra em um canal de voz primeiro.');
            }

            const termoOriginal = message.content.slice(8).trim();

            if (!termoOriginal) {
                return message.reply('Use: p!tocar nome da música, link do YouTube, link do Spotify ou playlist/álbum do Spotify');
            }

            // Playlist ou álbum do Spotify: busca a lista de faixas na API oficial
            // e vai adicionando na fila aos poucos, sem travar esperando tudo terminar.
            if (ehPlaylistOuAlbumSpotify(termoOriginal)) {
                let faixas;
                try {
                    faixas = await buscarFaixasSpotify(termoOriginal);
                } catch (erro) {
                    return message.reply(`❌ ${erro.message}`);
                }

                if (!faixas || faixas.length === 0) {
                    return message.reply('❌ Não encontrei músicas nessa playlist/álbum (confere se ela é pública).');
                }

                const fila = await garantirFila(message);
                if (!fila) {
                    return message.reply('❌ Não consegui entrar no canal de voz.');
                }

                message.reply(
                    `🔍 Encontrei ${faixas.length} música(s) na playlist. Buscando e adicionando à fila aos poucos, isso pode demorar um pouco...`
                );

                const faixasComPedido = faixas.map(f => ({ ...f, pedidoPor: message.author.username }));
                processarFaixasEmBackground(message.guild.id, faixasComPedido, message.channel);

                return;
            }

            let query;
            try {
                query = await resolverQuery(termoOriginal);
            } catch (erro) {
                return message.reply(`❌ ${erro.message}`);
            }

            let info;
            try {
                info = await buscarInfoMusica(query);
            } catch (erro) {
                console.error('Erro ao buscar música:', erro);
                return message.reply('❌ Não consegui buscar essa música.');
            }

            if (!info) {
                return message.reply('❌ Não encontrei nada com esse nome.');
            }

            const fila = await garantirFila(message);
            if (!fila) {
                return message.reply('❌ Não consegui entrar no canal de voz.');
            }

            fila.musicas.push({ ...info, pedidoPor: message.author.username });

            if (fila.musicas.length === 1 && fila.player.state.status !== AudioPlayerStatus.Playing) {
                tocarProximaMusica(message.guild.id);
            } else {
                message.reply(`✅ **${info.titulo}** adicionada à fila (posição ${fila.musicas.length}).`);
            }

            return;
        }

        // Fila
        if (message.content === 'p!fila') {
            const fila = filas.get(message.guild?.id);

            if (!fila || fila.musicas.length === 0) {
                return message.reply('A fila está vazia.');
            }

            const lista = fila.musicas.slice(0, 10).map((m, i) =>
                i === 0
                    ? `▶️ **${m.titulo}** (tocando agora, pedido por ${m.pedidoPor})`
                    : `${i}. ${m.titulo} — pedido por ${m.pedidoPor}`
            ).join('\n');

            const restante = fila.musicas.length > 10 ? `\n...e mais ${fila.musicas.length - 10}` : '';

            return message.reply(`🎶 **Fila (${fila.musicas.length})**\n${lista}${restante}`);
        }

        // Pular
        if (message.content === 'p!pular') {
            const fila = filas.get(message.guild?.id);

            if (!fila || fila.musicas.length === 0) {
                return message.reply('Não tem nada tocando.');
            }

            fila.player.stop();
            return message.reply('⏭️ Música pulada.');
        }

        // Pausar
        if (message.content === 'p!pausar') {
            const fila = filas.get(message.guild?.id);

            if (!fila) {
                return message.reply('Não tem nada tocando.');
            }

            fila.player.pause();
            return message.reply('⏸️ Pausado.');
        }

        // Continuar
        if (message.content === 'p!continuar') {
            const fila = filas.get(message.guild?.id);

            if (!fila) {
                return message.reply('Não tem nada tocando.');
            }

            fila.player.unpause();
            return message.reply('▶️ Continuando.');
        }

        // Parar
        if (message.content === 'p!parar') {
            const fila = filas.get(message.guild?.id);

            if (!fila) {
                return message.reply('Não tem nada tocando.');
            }

            fila.musicas = [];
            fila.connection.destroy();
            filas.delete(message.guild.id);
            return message.reply('⏹️ Parado e saí do canal de voz.');
        }

        // Loop
        if (message.content === 'p!loop') {
            const fila = filas.get(message.guild?.id);

            if (!fila) {
                return message.reply('Não tem nada tocando.');
            }

            fila.loop = !fila.loop;
            return message.reply(fila.loop ? '🔁 Loop ativado (repete a música atual).' : '🔁 Loop desativado.');
        }

        // ---------- Economia (Miracoins) ----------

        // Perfil
        if (message.content.startsWith('p!perfil')) {
            const alvo = pegarAlvo(message);
            const conta = pegarConta(alvo.id);

            const embed = new EmbedBuilder()
                .setAuthor({ name: alvo.username, iconURL: alvo.displayAvatarURL() })
                .setTitle('Perfil')
                .setColor(0xEB459E)
                .setThumbnail(alvo.displayAvatarURL())
                .addFields(
                    { name: 'Nível', value: `${conta.nivel}`, inline: true },
                    { name: 'Miracoins', value: `${conta.carteira.toLocaleString('pt-BR')} ✨`, inline: true },
                    { name: 'Banco', value: `${conta.banco.toLocaleString('pt-BR')} ✨`, inline: true }
                );

            if (conta.casadoCom) {
                try {
                    const parceiro = await client.users.fetch(conta.casadoCom);
                    embed.addFields({ name: '💍 Casado(a) com', value: parceiro.username, inline: true });
                } catch (_) {}
            }

            if (conta.emprestimo) {
                embed.addFields({ name: '📄 Dívida ativa', value: formatarMoeda(calcularDividaAtual(conta)), inline: true });
            }

            if (conta.tituloAtivo) {
                const titulo = pegarTitulo(conta.tituloAtivo);
                embed.addFields({ name: '🏷️ Título', value: titulo ? titulo.nome : conta.tituloAtivo, inline: true });
            }

            if (conta.miraculousComprados.length > 0) {
                const listaMiraculous = conta.miraculousComprados
                    .map(id => pegarMiraculous(id))
                    .filter(Boolean)
                    .map(m => `${m.emoji} ${m.nome}`)
                    .join('\n');
                embed.addFields({ name: '✨ Miraculous', value: listaMiraculous || '—', inline: false });
            }

            return message.reply({ embeds: [embed] });
        }

        // Leaderboard de mais ricos (com paginação, até top 50)
        {
            const matchLeaderboard = message.content.trim().match(/^p!(leaderboard|top|ricos)(?:\s+(\d+))?$/i);

            if (matchLeaderboard) {
                const entradas = Object.entries(economia)
                    .map(([id, conta]) => ({ id, total: (conta.carteira || 0) + (conta.banco || 0) }))
                    .filter(e => e.total > 0)
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 50);

                if (entradas.length === 0) {
                    return message.reply('📊 Ainda não tem ninguém com Miracoins registrado.');
                }

                const POR_PAGINA = 10;
                const totalPaginas = Math.ceil(entradas.length / POR_PAGINA);
                let paginaAtual = parseInt(matchLeaderboard[2], 10) || 1;
                paginaAtual = Math.min(Math.max(paginaAtual, 1), totalPaginas);

                const medalhas = ['🥇', '🥈', '🥉'];

                const construirEmbedPagina = async (pagina) => {
                    const inicio = (pagina - 1) * POR_PAGINA;
                    const fatia = entradas.slice(inicio, inicio + POR_PAGINA);
                    const linhas = [];

                    for (let i = 0; i < fatia.length; i++) {
                        const { id, total } = fatia[i];
                        const posicaoGeral = inicio + i;
                        let nome = `Usuário desconhecido (${id})`;
                        try {
                            const usuario = await client.users.fetch(id);
                            nome = usuario.username;
                        } catch (_) {}

                        const posicao = medalhas[posicaoGeral] || `${posicaoGeral + 1}.`;
                        linhas.push(`${posicao} **${nome}** — ${formatarMoeda(total)}`);
                    }

                    return new EmbedBuilder()
                        .setTitle('🏆 Ranking de Miracoins')
                        .setColor(0xF1C40F)
                        .setDescription(linhas.join('\n'))
                        .setFooter({ text: `Página ${pagina}/${totalPaginas} — considera carteira + banco` });
                };

                const embedInicial = await construirEmbedPagina(paginaAtual);
                const mensagem = await message.reply({ embeds: [embedInicial] });

                if (totalPaginas <= 1) {
                    return;
                }

                try {
                    await mensagem.react('⬅️');
                    await mensagem.react('➡️');
                } catch (_) {
                    return; // sem permissão de reagir, só fica na página pedida mesmo
                }

                const collector = mensagem.createReactionCollector({
                    filter: (reacao, usuario) =>
                        ['⬅️', '➡️'].includes(reacao.emoji.name) && usuario.id === message.author.id,
                    time: 60000
                });

                collector.on('collect', async (reacao, usuario) => {
                    if (reacao.emoji.name === '➡️' && paginaAtual < totalPaginas) {
                        paginaAtual++;
                    } else if (reacao.emoji.name === '⬅️' && paginaAtual > 1) {
                        paginaAtual--;
                    } else {
                        return;
                    }

                    const novoEmbed = await construirEmbedPagina(paginaAtual);
                    await mensagem.edit({ embeds: [novoEmbed] }).catch(() => {});
                    reacao.users.remove(usuario.id).catch(() => {});
                    collector.resetTimer();
                });

                collector.on('end', () => {
                    mensagem.reactions.removeAll().catch(() => {});
                });

                return;
            }
        }

        // Casar (com pedido, aceite/recusa e custo)
        if (message.content.startsWith('p!casar')) {
            const alvo = message.mentions.users.first();

            if (!alvo) {
                return message.reply('Use: p!casar @pessoa');
            }

            if (alvo.id === message.author.id) {
                return message.reply('❌ Você não pode casar consigo mesmo(a) haha.');
            }

            if (alvo.bot) {
                return message.reply('❌ Não dá pra casar com um bot 😅');
            }

            const contaAutor = pegarConta(message.author.id);
            const contaAlvo = pegarConta(alvo.id);

            if (contaAutor.casadoCom) {
                return message.reply('❌ Você já é casado(a)! Use `p!divorciar` primeiro.');
            }

            if (contaAlvo.casadoCom) {
                return message.reply(`❌ **${alvo.username}** já é casado(a) com outra pessoa.`);
            }

            if (contaAutor.carteira < CUSTO_CASAMENTO) {
                return message.reply(`❌ Casar custa ${formatarMoeda(CUSTO_CASAMENTO)} e você não tem esse valor. Carteira: ${formatarMoeda(contaAutor.carteira)}`);
            }

            await message.reply(
                `💍 **${message.author.username}** está pedindo **${alvo.username}** em casamento!\n` +
                `${alvo}, você aceita? Responda \`aceito\` ou \`recuso\`. (60s)\n` +
                `_Custo do casamento: ${formatarMoeda(CUSTO_CASAMENTO)} (sai da conta de quem pediu)_`
            );

            let colecionadas;
            try {
                colecionadas = await message.channel.awaitMessages({
                    filter: m => m.author.id === alvo.id && ['aceito', 'recuso'].includes(m.content.trim().toLowerCase()),
                    max: 1,
                    time: 60000,
                    errors: ['time']
                });
            } catch (_) {
                return message.channel.send('⌛ O pedido de casamento expirou sem resposta.');
            }

            const resposta = colecionadas.first().content.trim().toLowerCase();

            if (resposta === 'recuso') {
                return message.channel.send(`💔 **${alvo.username}** recusou o pedido de casamento.`);
            }

            // reconfere pra evitar corrida de condição enquanto esperava a resposta
            if (contaAutor.casadoCom || contaAlvo.casadoCom) {
                return message.channel.send('❌ Um dos dois já ficou casado(a) enquanto esperava a resposta.');
            }

            if (contaAutor.carteira < CUSTO_CASAMENTO) {
                return message.channel.send(`❌ **${message.author.username}** não tem mais os ${formatarMoeda(CUSTO_CASAMENTO)} necessários pro casamento.`);
            }

            contaAutor.carteira -= CUSTO_CASAMENTO;
            contaAutor.casadoCom = alvo.id;
            contaAlvo.casadoCom = message.author.id;
            salvarDados();

            const embed = new EmbedBuilder()
                .setTitle('💍 Casamento!')
                .setColor(0xFF69B4)
                .setDescription(
                    `**${message.author.username}** e **${alvo.username}** se casaram! 💕✨\n\n` +
                    `[! Ver GIF do casamento](${GIF_CASAMENTO})`
                );

            return message.channel.send({ embeds: [embed] });
        }

        // Divorciar
        if (message.content === 'p!divorciar') {
            const meuId = message.author.id;
            const contaBruta = economia[meuId];

            if (!contaBruta || !contaBruta.casadoCom) {
                return message.reply('❌ Você não está casado(a) com ninguém.');
            }

            const exParceiroId = contaBruta.casadoCom;
            if (!economia[exParceiroId]) economia[exParceiroId] = pegarConta(exParceiroId);
            const contaExBruta = economia[exParceiroId];

            let fusaoDesfeita = false;

            // Se tinham o anel de noivado (conta conjunta), desfaz a fusão e
            // divide o saldo compartilhado meio a meio entre os dois.
            if (contaBruta.contaConjuntaCom) {
                const chave = chaveCasal(meuId, exParceiroId);
                const compartilhada = contasConjuntas[chave];

                if (compartilhada) {
                    const metadeCarteira = Math.floor(compartilhada.carteira / 2);
                    const metadeBanco = Math.floor(compartilhada.banco / 2);

                    contaBruta.carteira = metadeCarteira + (compartilhada.carteira % 2);
                    contaBruta.banco = metadeBanco + (compartilhada.banco % 2);
                    contaExBruta.carteira = metadeCarteira;
                    contaExBruta.banco = metadeBanco;

                    delete contasConjuntas[chave];
                    fusaoDesfeita = true;
                }

                contaBruta.contaConjuntaCom = null;
                contaExBruta.contaConjuntaCom = null;
            }

            contaBruta.casadoCom = null;
            contaExBruta.casadoCom = null;
            salvarDados();

            let nomeExParceiro = 'seu(sua) ex';
            try {
                const usuario = await client.users.fetch(exParceiroId);
                nomeExParceiro = usuario.username;
            } catch (_) {}

            const embed = new EmbedBuilder()
                .setTitle('💔 Divórcio')
                .setColor(0x99AAB5)
                .setDescription(
                    `**${message.author.username}** e **${nomeExParceiro}** se divorciaram.` +
                    (fusaoDesfeita ? '\n💰 A conta conjunta (anel de noivado) foi desfeita — o saldo foi dividido meio a meio.' : '')
                );

            return message.reply({ embeds: [embed] });
        }

        // Loja (com categorias e páginas — navegação por botões e select menu)
        if (message.content === 'p!loja') {
            let categoriaIndex = 0;
            let pagina = 0;

            const inicial = construirEmbedLoja(categoriaIndex, pagina);
            pagina = inicial.pagina;

            const msgLoja = await message.channel.send({
                embeds: [inicial.embed],
                components: construirComponentesLoja(categoriaIndex, pagina, inicial.totalPaginas, inicial.fatia, inicial.inicio)
            });

            const coletor = msgLoja.createMessageComponentCollector({ time: 3 * 60 * 1000 });

            coletor.on('collect', async (interacao) => {
                if (interacao.user.id !== message.author.id) {
                    return interacao.reply({ content: '❌ Só quem abriu a loja pode navegar. Use `p!loja` pra abrir a sua.', ephemeral: true });
                }

                // Botão verde de compra rápida
                if (interacao.customId.startsWith('loja_comprar_')) {
                    const [, , catIdxStr, itemIdxStr] = interacao.customId.split('_');
                    const categoria = LOJA_CATEGORIAS[parseInt(catIdxStr, 10)];
                    const item = categoria?.itens[parseInt(itemIdxStr, 10)];

                    if (!item) {
                        return interacao.reply({ content: '❌ Esse item não existe mais. Abra a loja de novo com `p!loja`.', ephemeral: true });
                    }

                    await executarCompraDireta({
                        autorId: interacao.user.id,
                        autorUsername: interacao.user.username,
                        responderErro: (texto) => interacao.reply({ content: texto, ephemeral: true }),
                        enviarPublico: (texto) => interacao.reply({ content: texto })
                    }, item);

                    return;
                }

                // Botão cinza "Ver comando" — itens que precisam de argumento extra (vip/emoji)
                if (interacao.customId.startsWith('loja_vercomando_')) {
                    const [, , catIdxStr, itemIdxStr] = interacao.customId.split('_');
                    const categoria = LOJA_CATEGORIAS[parseInt(catIdxStr, 10)];
                    const item = categoria?.itens[parseInt(itemIdxStr, 10)];

                    if (!item) {
                        return interacao.reply({ content: '❌ Esse item não existe mais. Abra a loja de novo com `p!loja`.', ephemeral: true });
                    }

                    return interacao.reply({ content: `Use: \`${item.comando}\``, ephemeral: true });
                }

                if (interacao.customId === 'loja_categoria') {
                    categoriaIndex = parseInt(interacao.values[0], 10);
                    pagina = 0;
                } else if (interacao.customId === 'loja_anterior') {
                    pagina = Math.max(0, pagina - 1);
                } else if (interacao.customId === 'loja_proximo') {
                    pagina += 1;
                }

                const atualizado = construirEmbedLoja(categoriaIndex, pagina);
                pagina = atualizado.pagina;

                await interacao.update({
                    embeds: [atualizado.embed],
                    components: construirComponentesLoja(categoriaIndex, pagina, atualizado.totalPaginas, atualizado.fatia, atualizado.inicio)
                });
            });

            coletor.on('end', () => {
                msgLoja.edit({ components: [] }).catch(() => {});
            });

            return;
        }

        // Comprar item da loja
        if (message.content.startsWith('p!comprar')) {
            const argumentos = message.content.slice('p!comprar'.length).trim();
            const [itemBruto, ...resto] = argumentos.split(/\s+/);
            const item = (itemBruto || '').toLowerCase();
            const argsRestantes = resto.join(' ').trim();

            if (!item) {
                return message.reply('Use: p!comprar <item>\nVeja os itens disponíveis com `p!loja`.');
            }

            // --- Cargo VIP personalizado ---
            if (item === 'vip') {
                if (!message.guild) return message.reply('❌ Esse comando só funciona dentro de um servidor.');

                const [nomeCargoBruto, corBruta] = argsRestantes.split('|').map(p => p?.trim());

                if (!nomeCargoBruto || !corBruta) {
                    return message.reply('Use: p!comprar vip Nome do Cargo | #FF00AA');
                }

                if (nomeCargoBruto.length > 100) {
                    return message.reply('❌ Nome do cargo muito longo (máximo 100 caracteres).');
                }

                const corHex = corBruta.startsWith('#') ? corBruta : `#${corBruta}`;
                if (!/^#[0-9A-Fa-f]{6}$/.test(corHex)) {
                    return message.reply('❌ Cor inválida. Use um código hexadecimal, tipo #FF00AA.');
                }

                const conta = pegarConta(message.author.id);

                if (conta.carteira < PRECO_VIP) {
                    return message.reply(`❌ O cargo VIP custa ${formatarMoeda(PRECO_VIP)} e você não tem esse valor. Carteira: ${formatarMoeda(conta.carteira)}`);
                }

                if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                    return message.reply('❌ Não tenho permissão de Gerenciar Cargos nesse servidor.');
                }

                try {
                    let cargo = conta.cargoVipId ? await message.guild.roles.fetch(conta.cargoVipId).catch(() => null) : null;

                    if (cargo) {
                        if (cargo.position >= message.guild.members.me.roles.highest.position) {
                            return message.reply('❌ Não consigo editar esse cargo (ele está numa posição igual ou acima do meu cargo mais alto).');
                        }
                        await cargo.setName(nomeCargoBruto);
                        await cargo.setColor(corHex);
                    } else {
                        cargo = await message.guild.roles.create({
                            name: nomeCargoBruto,
                            color: corHex,
                            hoist: true,
                            mentionable: false,
                            reason: `Cargo VIP comprado na loja por ${message.author.tag}`
                        });

                        const membro = await message.guild.members.fetch(message.author.id);
                        await membro.roles.add(cargo);
                    }

                    // Sobe o cargo VIP pro topo possível (logo abaixo do cargo mais alto
                    // do bot), assim ele aparece destacado/hoisted no topo da lista de
                    // membros, com cor e (se o servidor tiver boost nível 2+) ícone.
                    try {
                        const posicaoTopo = message.guild.members.me.roles.highest.position - 1;
                        if (posicaoTopo > 0 && cargo.position < posicaoTopo) {
                            await cargo.setPosition(posicaoTopo);
                        }
                    } catch (erro) {
                        console.error('Erro ao reposicionar cargo VIP no topo:', erro);
                    }

                    conta.carteira -= PRECO_VIP;
                    conta.cargoVipId = cargo.id;
                    salvarDados();

                    return message.channel.send(`👑 **${message.author.username}** comprou/atualizou o cargo VIP: **${nomeCargoBruto}** (${corHex})!`);
                } catch (erro) {
                    console.error('Erro ao criar/editar cargo VIP:', erro);
                    return message.reply('❌ Deu erro ao criar/editar o cargo. Confere se meu cargo está acima da posição desejada.');
                }
            }

            // --- Emoji personalizado ---
            if (item === 'emoji') {
                if (!message.guild) return message.reply('❌ Esse comando só funciona dentro de um servidor.');

                const nomeEmoji = argsRestantes.replace(/[^a-zA-Z0-9_]/g, '');
                const anexo = message.attachments.first();

                if (!nomeEmoji || !anexo) {
                    return message.reply('Use: p!comprar emoji nome_do_emoji (com uma imagem anexada na mesma mensagem)');
                }

                if (nomeEmoji.length < 2 || nomeEmoji.length > 32) {
                    return message.reply('❌ O nome do emoji precisa ter entre 2 e 32 caracteres (só letras, números e _).');
                }

                const conta = pegarConta(message.author.id);

                if (conta.carteira < PRECO_EMOJI) {
                    return message.reply(`❌ O emoji personalizado custa ${formatarMoeda(PRECO_EMOJI)} e você não tem esse valor. Carteira: ${formatarMoeda(conta.carteira)}`);
                }

                try {
                    const emojiCriado = await message.guild.emojis.create({
                        attachment: anexo.url,
                        name: nomeEmoji,
                        reason: `Emoji comprado na loja por ${message.author.tag}`
                    });

                    conta.carteira -= PRECO_EMOJI;
                    salvarDados();

                    return message.channel.send(`😎 **${message.author.username}** adicionou o emoji ${emojiCriado} (\`:${nomeEmoji}:\`) ao servidor!`);
                } catch (erro) {
                    console.error('Erro ao criar emoji:', erro);
                    return message.reply('❌ Deu erro ao criar o emoji. Confere se o servidor não atingiu o limite de emojis, se eu tenho permissão, e se a imagem é válida (PNG/JPG/GIF, até 256KB).');
                }
            }

            // --- Anel de noivado (funde a conta com a do cônjuge) ---
            if (item === 'anel') {
                return executarCompraAnel({
                    autorId: message.author.id,
                    autorUsername: message.author.username,
                    responderErro: (texto) => message.reply(texto),
                    enviarPublico: (texto) => message.channel.send(texto)
                });
            }

            // --- Título (aparece do lado do apelido) ---
            if (item === 'titulo' || item === 'título') {
                const idTitulo = argsRestantes.trim().toLowerCase();
                return executarCompraTitulo({
                    autorId: message.author.id,
                    autorUsername: message.author.username,
                    responderErro: (texto) => message.reply(texto),
                    enviarPublico: (texto) => message.channel.send(texto)
                }, idTitulo);
            }

            // --- Miraculous (dá acesso a um poder de combate) ---
            if (item === 'miraculous') {
                const idMiraculous = argsRestantes.trim().toLowerCase();
                return executarCompraMiraculous({
                    autorId: message.author.id,
                    autorUsername: message.author.username,
                    responderErro: (texto) => message.reply(texto),
                    enviarPublico: (texto) => message.channel.send(texto)
                }, idMiraculous);
            }

            return message.reply('❌ Item inválido. Veja os itens disponíveis com `p!loja`.');
        }

        // Equipar/remover título comprado (aparece do lado do apelido)
        if (message.content.startsWith('p!titulo') || message.content.startsWith('p!título')) {
            const partes = message.content.trim().split(/\s+/);
            const argumento = (partes[1] || '').toLowerCase();
            const conta = pegarConta(message.author.id);

            if (!argumento) {
                if (conta.titulosComprados.length === 0) {
                    return message.reply('❌ Você ainda não comprou nenhum título. Veja a loja com `p!loja`.');
                }
                return message.reply(
                    'Use: p!titulo <id> (pra equipar) ou p!titulo remover (pra tirar)\nSeus títulos:\n' +
                    conta.titulosComprados.map(id => `\`${id}\` — ${pegarTitulo(id)?.nome || id}`).join('\n')
                );
            }

            if (argumento === 'remover') {
                conta.tituloAtivo = null;
                salvarDados();
                await aplicarTituloNoApelido(message, conta);
                return message.reply('✅ Título removido do seu apelido.');
            }

            if (!conta.titulosComprados.includes(argumento)) {
                return message.reply('❌ Você não tem esse título. Compre na loja com `p!comprar titulo <id>`.');
            }

            conta.tituloAtivo = argumento;
            salvarDados();
            await aplicarTituloNoApelido(message, conta);

            const titulo = pegarTitulo(argumento);
            return message.reply(`✅ Título equipado: **${titulo ? titulo.nome : argumento}**`);
        }

        // Trabalhar: renda pequena e segura, com cooldown
        if (message.content === 'p!trabalhar') {
            const conta = pegarConta(message.author.id);
            const agora = Date.now();
            const desde = agora - conta.ultimoTrabalho;

            if (conta.ultimoTrabalho !== 0 && desde < TRABALHO_COOLDOWN_MS) {
                const faltamMin = Math.ceil((TRABALHO_COOLDOWN_MS - desde) / 60000);
                return message.reply(`⏳ Você já trabalhou recentemente. Tente de novo em ~${faltamMin} min.`);
            }

            const ganho = Math.floor(Math.random() * (TRABALHO_MAX - TRABALHO_MIN + 1)) + TRABALHO_MIN;
            conta.ultimoTrabalho = agora;
            conta.carteira += ganho;
            salvarDados();

            const bicos = ['entregou uns panfletos', 'ajudou numa mudança', 'fez um bico de motorista', 'lavou uns carros', 'passeou com cachorros do bairro'];
            const bico = bicos[Math.floor(Math.random() * bicos.length)];

            return message.reply(`💼 Você ${bico} e ganhou ${formatarMoeda(ganho)}!`);
        }

        // Crime: 60% de chance de dar errado e ficar devendo (dívida vira negativo na carteira)
        if (message.content === 'p!crime') {
            const conta = pegarConta(message.author.id);
            const agora = Date.now();
            const desde = agora - conta.ultimoCrime;

            if (conta.ultimoCrime !== 0 && desde < CRIME_COOLDOWN_MS) {
                const faltamMin = Math.ceil((CRIME_COOLDOWN_MS - desde) / 60000);
                return message.reply(`⏳ Muito arriscado tentar de novo agora. Tente em ~${faltamMin} min.`);
            }

            conta.ultimoCrime = agora;
            const deuCerto = Math.random() < CRIME_CHANCE_SUCESSO;

            if (deuCerto) {
                const ganho = Math.floor(Math.random() * (CRIME_GANHO_MAX - CRIME_GANHO_MIN + 1)) + CRIME_GANHO_MIN;
                conta.carteira += ganho;
                salvarDados();
                return message.reply(`🕵️ O crime deu certo! Você ganhou ${formatarMoeda(ganho)}.`);
            }

            const multa = Math.floor(Math.random() * (CRIME_MULTA_MAX - CRIME_MULTA_MIN + 1)) + CRIME_MULTA_MIN;
            conta.carteira -= multa; // pode ficar negativo — a pessoa fica devendo
            salvarDados();

            return message.reply(
                `🚨 Você foi pego! Pagou ${formatarMoeda(multa)} de multa.` +
                (conta.carteira < 0 ? `\n💸 Sua carteira ficou negativa: ${formatarMoeda(conta.carteira)} (você está devendo).` : '')
            );
        }

        // ---------- Poderes dos Miraculous ----------

        // Joaninha — Talismã: prende (muta) o alvo por 20s
        if (comandoBate(message.content, 'p!talisma')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'joaninha')) return message.reply('❌ Você precisa do Miraculous da Joaninha pra usar esse poder.');

            const cooldownJoaninha = pegarCooldownRestante(message, conta, 'joaninha');
            if (cooldownJoaninha > 0) return message.reply(`⏳ O Talismã está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownJoaninha)}.`);

            const alvo = message.mentions.users.first();
            if (!alvo) return message.reply('Use: p!talismã @pessoa');

            registrarUsoPoder(conta, 'joaninha');
            salvarDados();

            const frase = `🐞 **${message.author.username}** usou o talismã e prendeu **${alvo.username}**!`;
            const resultado = await aplicarAtaqueMute(message, alvo, 20000, frase);
            return message.channel.send(resultado);
        }

        // Gato — Cataclismo: apaga a mensagem que o usuário está respondendo
        if (comandoBate(message.content, 'p!cataclismo')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'gato')) return message.reply('❌ Você precisa do Miraculous do Gato pra usar esse poder.');

            const cooldownGato = pegarCooldownRestante(message, conta, 'gato');
            if (cooldownGato > 0) return message.reply(`⏳ O Cataclismo está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownGato)}.`);

            const refId = message.reference?.messageId;
            if (!refId) return message.reply('❌ Responda a mensagem que você quer apagar e use `p!cataclismo`.');

            try {
                const msgAlvo = await message.channel.messages.fetch(refId);
                await msgAlvo.delete();
                registrarUsoPoder(conta, 'gato');
                salvarDados();
                return message.channel.send(`🐈‍⬛ **${message.author.username}** usou o cataclismo e apagou a mensagem!`);
            } catch (erro) {
                console.error('Erro ao usar cataclismo:', erro);
                return message.reply('❌ Não consegui apagar essa mensagem (permissão ou ela já não existe mais).');
            }
        }

        // Pavão — Sentimonstro: cria um aliado que absorve o próximo ataque
        if (comandoBate(message.content, 'p!sentimonstro')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'pavao')) return message.reply('❌ Você precisa do Miraculous do Pavão pra usar esse poder.');

            const cooldownPavao = pegarCooldownRestante(message, conta, 'pavao');
            if (cooldownPavao > 0) return message.reply(`⏳ O Sentimonstro está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownPavao)}.`);

            conta.escudoTartaruga += 1;
            registrarUsoPoder(conta, 'pavao');
            salvarDados();

            return message.channel.send(`🦚 **${message.author.username}** invocou um Sentimonstro, que vai tomar o próximo ataque no lugar dele.`);
        }

        // Raposa — Miragem: por um tempo, mostra um alvo falso ao usar comandos
        if (comandoBate(message.content, 'p!miragem')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'raposa')) return message.reply('❌ Você precisa do Miraculous da Raposa pra usar esse poder.');

            const cooldownRaposa = pegarCooldownRestante(message, conta, 'raposa');
            if (cooldownRaposa > 0) return message.reply(`⏳ A Miragem está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownRaposa)}.`);

            conta.ilusaoAte = Date.now() + 5 * 60 * 1000;
            registrarUsoPoder(conta, 'raposa');
            salvarDados();

            return message.channel.send(`🦊 **${message.author.username}** criou uma ilusão! Por 5 minutos, seus próximos ataques podem mostrar um alvo falso.`);
        }

        // Abelha — Ferroada: paralisa (muta) o alvo por 20s
        if (comandoBate(message.content, 'p!ferroada')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'abelha')) return message.reply('❌ Você precisa do Miraculous da Abelha pra usar esse poder.');

            const cooldownAbelha = pegarCooldownRestante(message, conta, 'abelha');
            if (cooldownAbelha > 0) return message.reply(`⏳ A Ferroada está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownAbelha)}.`);

            const alvo = message.mentions.users.first();
            if (!alvo) return message.reply('Use: p!ferroada @pessoa');

            registrarUsoPoder(conta, 'abelha');
            salvarDados();

            let nomeExibido = alvo.username;
            if (conta.ilusaoAte && Date.now() <= conta.ilusaoAte && message.guild) {
                const membrosCache = message.guild.members.cache.filter(m => !m.user.bot && m.id !== alvo.id);
                if (membrosCache.size > 0) {
                    nomeExibido = membrosCache.random().user.username;
                }
            }

            const frase = `🐝 **${message.author.username}** usou a ferroada e paralisou **${nomeExibido}**!`;
            const resultado = await aplicarAtaqueMute(message, alvo, 20000, frase);
            return message.channel.send(resultado);
        }

        // Tartaruga — Casco-Protetor: imune aos próximos 2 ataques
        if (comandoBate(message.content, 'p!protecao')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'tartaruga')) return message.reply('❌ Você precisa do Miraculous da Tartaruga pra usar esse poder.');

            const cooldownTartaruga = pegarCooldownRestante(message, conta, 'tartaruga');
            if (cooldownTartaruga > 0) return message.reply(`⏳ O Casco-Protetor está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownTartaruga)}.`);

            conta.escudoTartaruga += 2;
            registrarUsoPoder(conta, 'tartaruga');
            salvarDados();

            return message.channel.send(`🐢 **${message.author.username}** ergueu um Casco-Protetor! Imune aos próximos 2 ataques.`);
        }

        // Cavalo — Viagem: troca de posição com alguém aleatório do chat pra receber o próximo ataque no lugar dela
        if (comandoBate(message.content, 'p!viajar')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'cavalo')) return message.reply('❌ Você precisa do Miraculous do Cavalo pra usar esse poder.');

            const cooldownCavalo = pegarCooldownRestante(message, conta, 'cavalo');
            if (cooldownCavalo > 0) return message.reply(`⏳ A Viagem está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownCavalo)}.`);

            try {
                const recentes = await message.channel.messages.fetch({ limit: 30 });
                const candidatos = [...new Set(
                    recentes
                        .filter(m => !m.author.bot && m.author.id !== message.author.id)
                        .map(m => m.author.id)
                )];

                if (candidatos.length === 0) {
                    return message.reply('❌ Não achei ninguém recente no chat pra trocar de lugar.');
                }

                const sorteadoId = candidatos[Math.floor(Math.random() * candidatos.length)];
                conta.redirecionarAtaquePara = sorteadoId;
                conta.redirecionarAte = Date.now() + 60 * 1000;
                registrarUsoPoder(conta, 'cavalo');
                salvarDados();

                let nomeSorteado = 'alguém';
                try {
                    const usuario = await client.users.fetch(sorteadoId);
                    nomeSorteado = usuario.username;
                } catch (_) {}

                return message.channel.send(`🐴 **${message.author.username}** abriu um portal! Pelo próximo minuto, quem receber o próximo ataque destinado a ele(a) será **${nomeSorteado}**.`);
            } catch (erro) {
                console.error('Erro ao usar viagem:', erro);
                return message.reply('❌ Deu erro ao abrir o portal.');
            }
        }

        // Cobra — Segunda Chance: cancela o próximo efeito negativo em até 30s
        if (comandoBate(message.content, 'p!segunda-chance') || comandoBate(message.content, 'p!segundachance')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'cobra')) return message.reply('❌ Você precisa do Miraculous da Cobra pra usar esse poder.');

            const cooldownCobra = pegarCooldownRestante(message, conta, 'cobra');
            if (cooldownCobra > 0) return message.reply(`⏳ A Segunda Chance está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownCobra)}.`);

            conta.segundaChanceAte = Date.now() + 30 * 1000;
            registrarUsoPoder(conta, 'cobra');
            salvarDados();

            return message.channel.send(`🐍 **${message.author.username}** usou a Segunda Chance! Qualquer efeito negativo nos próximos 30 segundos será cancelado.`);
        }

        // Boi (Stompp) — Resistência: imune a 1 golpe
        if (comandoBate(message.content, 'p!resistencia')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'boi')) return message.reply('❌ Você precisa do Miraculous do Boi pra usar esse poder.');

            const cooldownBoi = pegarCooldownRestante(message, conta, 'boi');
            if (cooldownBoi > 0) return message.reply(`⏳ A Resistência está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownBoi)}.`);

            conta.resistenciaBoi = true;
            registrarUsoPoder(conta, 'boi');
            salvarDados();

            return message.channel.send(`🐂 **${message.author.username}** ficou imune a magia! Não pode ser afetado(a) pelo próximo golpe.`);
        }

        // Cachorro — Busca: mute de 20s no alvo
        if (comandoBate(message.content, 'p!pega', 'p!pega!')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'cachorro')) return message.reply('❌ Você precisa do Miraculous do Cachorro pra usar esse poder.');

            const cooldownCachorro = pegarCooldownRestante(message, conta, 'cachorro');
            if (cooldownCachorro > 0) return message.reply(`⏳ A Busca está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownCachorro)}.`);

            const alvo = message.mentions.users.first();
            if (!alvo) return message.reply('Use: p!pega! @pessoa');

            registrarUsoPoder(conta, 'cachorro');
            salvarDados();

            const frase = `🐶 **${message.author.username}** usou seu poder pega! e conseguiu pegar a calcinha de **${alvo.username}**, que ficou tímido demais pra falar qualquer coisa.`;
            const resultado = await aplicarAtaqueMute(message, alvo, 20000, frase);
            return message.channel.send(resultado);
        }

        // Tigre (Roarr) — Golpe Poderoso: apaga as últimas 8 mensagens do canal
        if (comandoBate(message.content, 'p!colisao')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'tigre')) return message.reply('❌ Você precisa do Miraculous do Tigre pra usar esse poder.');

            const cooldownTigre = pegarCooldownRestante(message, conta, 'tigre');
            if (cooldownTigre > 0) return message.reply(`⏳ A Colisão está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownTigre)}.`);

            try {
                await message.channel.bulkDelete(8, true);
                registrarUsoPoder(conta, 'tigre');
                salvarDados();
                return message.channel.send(`🐯 **${message.author.username}** desferiu um golpe devastador! As últimas mensagens foram apagadas.`);
            } catch (erro) {
                console.error('Erro ao usar colisão:', erro);
                return message.reply('❌ Não consegui apagar as mensagens (preciso de permissão de Gerenciar Mensagens, e elas não podem ter mais de 14 dias).');
            }
        }

        // Águia (Liiri) — Liberdade: remove mutes e efeitos de controle do alvo
        if (comandoBate(message.content, 'p!libertar')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'aguia')) return message.reply('❌ Você precisa do Miraculous da Águia pra usar esse poder.');

            const cooldownAguia = pegarCooldownRestante(message, conta, 'aguia');
            if (cooldownAguia > 0) return message.reply(`⏳ A Libertação está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownAguia)}.`);

            const alvo = pegarAlvo(message);
            const contaAlvo = pegarConta(alvo.id);

            contaAlvo.segundaChanceAte = 0;
            contaAlvo.redirecionarAtaquePara = null;
            contaAlvo.redirecionarAte = 0;
            registrarUsoPoder(conta, 'aguia');
            salvarDados();

            if (message.guild) {
                const membroAlvo = await message.guild.members.fetch(alvo.id).catch(() => null);
                if (membroAlvo && membroAlvo.moderatable) {
                    await membroAlvo.timeout(null).catch(() => {});
                }
            }

            return message.channel.send(`🦅 **${message.author.username}** libertou **${alvo.username}** de mutes e efeitos de controle!`);
        }

        // Cabra — Gênese: chove Miracoins pras últimas 5 pessoas que falaram no canal
        if (comandoBate(message.content, 'p!genesis')) {
            const conta = pegarConta(message.author.id);
            if (!temMiraculous(conta, 'cabra')) return message.reply('❌ Você precisa do Miraculous da Cabra pra usar esse poder.');

            const cooldownCabra = pegarCooldownRestante(message, conta, 'cabra');
            if (cooldownCabra > 0) return message.reply(`⏳ A Gênese está em cooldown. Tente novamente em ${formatarTempoRestante(cooldownCabra)}.`);

            try {
                const recentes = await message.channel.messages.fetch({ limit: 30 });
                const idsUnicos = [...new Set(
                    recentes
                        .filter(m => !m.author.bot)
                        .map(m => m.author.id)
                )].slice(0, 5);

                if (idsUnicos.length === 0) {
                    return message.reply('❌ Não achei ninguém recente no chat pra chover Miracoins.');
                }

                const mencoes = [];
                for (const id of idsUnicos) {
                    const contaGanhador = pegarConta(id);
                    contaGanhador.carteira += 250;
                    mencoes.push(`<@${id}>`);
                }
                registrarUsoPoder(conta, 'cabra');
                salvarDados();

                return message.channel.send(
                    `🐐 **${message.author.username}** fez chover Miracoins, ${mencoes.join(' ')} ganharam ${formatarMoeda(250)} cada!`
                );
            } catch (erro) {
                console.error('Erro ao usar gênese:', erro);
                return message.reply('❌ Deu erro ao fazer chover Miracoins.');
            }
        }

        // Depositar no banco
        if (message.content.startsWith('p!depositar')) {
            const partes = message.content.trim().split(/\s+/);
            const conta = pegarConta(message.author.id);
            const valor = parseValorEconomia(partes[1], conta.carteira);

            if (!Number.isInteger(valor) || valor <= 0) {
                return message.reply(`Use: p!depositar (valor) ou p!depositar tudo\nCarteira: ${formatarMoeda(conta.carteira)}`);
            }

            if (valor > conta.carteira) {
                return message.reply(`❌ Você não tem esse valor na carteira. Saldo: ${formatarMoeda(conta.carteira)}`);
            }

            conta.carteira -= valor;
            conta.banco += valor;
            salvarDados();

            return message.reply(
                `🏦 Depositado ${formatarMoeda(valor)} no banco.\n` +
                `Carteira: ${formatarMoeda(conta.carteira)} | Banco: ${formatarMoeda(conta.banco)}`
            );
        }

        // Pagar imposto voluntariamente (o valor vai direto pro fundo do imposto)
        if (message.content.startsWith('p!pagarp')) {
            const partes = message.content.trim().split(/\s+/);
            const conta = pegarConta(message.author.id);
            const valor = parseValorEconomia(partes[1], conta.carteira);

            if (!Number.isInteger(valor) || valor <= 0) {
                return message.reply(`Use: p!pagarp (valor) ou p!pagarp tudo\nCarteira: ${formatarMoeda(conta.carteira)}`);
            }

            if (valor > conta.carteira) {
                return message.reply(`❌ Você não tem esse valor na carteira. Saldo: ${formatarMoeda(conta.carteira)}`);
            }

            conta.carteira -= valor;
            impostoArrecadado += valor;
            salvarDados();

            return message.reply(
                `🏛️ Você pagou ${formatarMoeda(valor)} de imposto.\n` +
                `Carteira: ${formatarMoeda(conta.carteira)}`
            );
        }


        // Sacar do banco
        if (message.content.startsWith('p!sacar')) {
            const partes = message.content.trim().split(/\s+/);
            const conta = pegarConta(message.author.id);
            const valor = parseValorEconomia(partes[1], conta.banco);

            if (!Number.isInteger(valor) || valor <= 0) {
                return message.reply(`Use: p!sacar (valor) ou p!sacar tudo\nBanco: ${formatarMoeda(conta.banco)}`);
            }

            if (valor > conta.banco) {
                return message.reply(`❌ Você não tem esse valor no banco. Saldo: ${formatarMoeda(conta.banco)}`);
            }

            conta.banco -= valor;
            conta.carteira += valor;
            salvarDados();

            return message.reply(
                `🏦 Sacado ${formatarMoeda(valor)} do banco.\n` +
                `Carteira: ${formatarMoeda(conta.carteira)} | Banco: ${formatarMoeda(conta.banco)}`
            );
        }

        // Transferir Miracoins pra outra pessoa
        if (message.content.startsWith('p!transferir')) {
            const partes = message.content.trim().split(/\s+/);
            const alvo = message.mentions.users.first();
            const contaAutor = pegarConta(message.author.id);

            if (!alvo || alvo.id === message.author.id) {
                return message.reply('Use: p!transferir @pessoa (valor)');
            }

            const valor = parseValorEconomia(partes[partes.length - 1], contaAutor.carteira);

            if (!Number.isInteger(valor) || valor <= 0) {
                return message.reply('Use: p!transferir @pessoa (valor)');
            }

            if (valor > contaAutor.carteira) {
                return message.reply(`❌ Você não tem esse valor na carteira. Saldo: ${formatarMoeda(contaAutor.carteira)}`);
            }

            const contaAlvo = pegarConta(alvo.id);
            contaAutor.carteira -= valor;
            contaAlvo.carteira += valor;
            salvarDados();

            return message.reply(`💸 Você transferiu ${formatarMoeda(valor)} pra **${alvo.username}**.`);
        }

        // Cobrar dinheiro de outra pessoa (ela precisa aceitar)
        if (message.content.startsWith('p!cobrar ')) {
            const partes = message.content.trim().split(/\s+/);
            const alvo = message.mentions.users.first();

            if (!alvo || alvo.id === message.author.id) {
                return message.reply('Use: p!cobrar @pessoa (valor)');
            }

            const valor = parseInt((partes[partes.length - 1] || '').replace(/\./g, ''), 10);

            if (!Number.isInteger(valor) || valor <= 0) {
                return message.reply('Use: p!cobrar @pessoa (valor)');
            }

            await message.reply(
                `🧾 **${message.author.username}** está cobrando ${formatarMoeda(valor)} de ${alvo}.\n` +
                `Responda \`pagar\` pra aceitar ou \`recusar\` pra ignorar. (60s)`
            );

            let colecionadas;
            try {
                colecionadas = await message.channel.awaitMessages({
                    filter: m => m.author.id === alvo.id && ['pagar', 'recusar'].includes(m.content.trim().toLowerCase()),
                    max: 1,
                    time: 60000,
                    errors: ['time']
                });
            } catch (_) {
                return message.channel.send('⌛ A cobrança expirou sem resposta.');
            }

            const resposta = colecionadas.first().content.trim().toLowerCase();

            if (resposta === 'recusar') {
                return message.channel.send(`❌ **${alvo.username}** recusou a cobrança.`);
            }

            const contaAlvo = pegarConta(alvo.id);

            if (valor > contaAlvo.carteira) {
                return message.channel.send(`❌ **${alvo.username}** não tem Miracoins suficientes pra pagar essa cobrança.`);
            }

            const contaAutor = pegarConta(message.author.id);
            contaAlvo.carteira -= valor;
            contaAutor.carteira += valor;
            salvarDados();

            return message.channel.send(`✅ **${alvo.username}** pagou ${formatarMoeda(valor)} pra **${message.author.username}**.`);
        }

        // Diário
        if (message.content === 'p!diario') {
            const conta = pegarConta(message.author.id);
            const agora = Date.now();
            const desdeUltimo = agora - conta.diarioUltimo;

            if (conta.diarioUltimo !== 0 && desdeUltimo < DIARIO_INTERVALO_MS) {
                const faltam = DIARIO_INTERVALO_MS - desdeUltimo;
                const horas = Math.ceil(faltam / (60 * 60 * 1000));
                return message.reply(`⏳ Você já pegou o diário hoje. Tente de novo em ~${horas}h.`);
            }

            if (conta.diarioUltimo !== 0 && desdeUltimo <= DIARIO_TOLERANCIA_MS) {
                conta.diarioStreak += 1;
            } else {
                conta.diarioStreak = 1;
            }

            conta.diarioUltimo = agora;

            const multiplicacoes = Math.floor((conta.diarioStreak - 1) / 5);
            const valor = DIARIO_BASE * Math.pow(2, multiplicacoes);

            conta.carteira += valor;
            salvarDados();

            return message.reply(
                `📅 Diário resgatado! Você ganhou ${formatarMoeda(valor)}.\n` +
                `🔥 Sequência: ${conta.diarioStreak} dia(s)` +
                (multiplicacoes > 0 ? ` (dobrou ${multiplicacoes}x)` : '')
            );
        }

        // Pegar empréstimo (sai do imposto arrecadado)
        if (message.content.startsWith('p!emprestimo')) {
            const partes = message.content.trim().split(/\s+/);
            const conta = pegarConta(message.author.id);

            if (conta.emprestimo) {
                const divida = calcularDividaAtual(conta);
                return message.reply(`❌ Você já tem um empréstimo ativo. Dívida atual: ${formatarMoeda(divida)}. Pague com \`p!pagar\` antes de pegar outro.`);
            }

            const valor = parseInt((partes[1] || '').replace(/\./g, ''), 10);

            if (!Number.isInteger(valor) || valor <= 0) {
                return message.reply('Use: p!emprestimo (valor)');
            }

            if (valor > impostoArrecadado) {
                return message.reply(`❌ O fundo de imposto não tem esse valor disponível. Imposto arrecadado: ${formatarMoeda(impostoArrecadado)}`);
            }

            impostoArrecadado -= valor;
            conta.carteira += valor;
            conta.emprestimo = { valor, dataPegou: Date.now() };
            salvarDados();

            return message.reply(
                `💸 Empréstimo de ${formatarMoeda(valor)} liberado (descontado do imposto arrecadado).\n` +
                `Você tem 2 dias pra pagar sem juros. Depois disso, juros de ${Math.round(JUROS_EMPRESTIMO * 100)}% compostos a cada 2 dias de atraso.\n` +
                'Pague com `p!pagar (valor)` ou `p!pagar tudo`.'
            );
        }

        // Pagar empréstimo
        if (message.content.startsWith('p!pagar')) {
            const partes = message.content.trim().split(/\s+/);
            const conta = pegarConta(message.author.id);

            if (!conta.emprestimo) {
                return message.reply('❌ Você não tem nenhum empréstimo ativo.');
            }

            const dividaAtual = calcularDividaAtual(conta);
            const valor = parseValorEconomia(partes[1], Math.min(conta.carteira, dividaAtual));

            if (!Number.isInteger(valor) || valor <= 0) {
                return message.reply(`Use: p!pagar (valor) ou p!pagar tudo\nDívida atual: ${formatarMoeda(dividaAtual)}`);
            }

            if (valor > conta.carteira) {
                return message.reply(`❌ Você não tem esse valor na carteira. Carteira: ${formatarMoeda(conta.carteira)}`);
            }

            const valorPago = Math.min(valor, dividaAtual);
            conta.carteira -= valorPago;
            impostoArrecadado += valorPago;

            const restante = dividaAtual - valorPago;

            if (restante <= 0) {
                conta.emprestimo = null;
                salvarDados();
                return message.reply(`✅ Empréstimo quitado! Você pagou ${formatarMoeda(valorPago)}.`);
            }

            conta.emprestimo = { valor: restante, dataPegou: Date.now() };
            salvarDados();
            return message.reply(`💰 Pagamento parcial de ${formatarMoeda(valorPago)}. Ainda deve ${formatarMoeda(restante)} (prazo de 2 dias renovado).`);
        }

        // Ver dívida
        if (message.content === 'p!divida') {
            const conta = pegarConta(message.author.id);

            if (!conta.emprestimo) {
                return message.reply('✅ Você não tem nenhum empréstimo ativo.');
            }

            const divida = calcularDividaAtual(conta);
            return message.reply(`📄 Sua dívida atual é de ${formatarMoeda(divida)} (empréstimo original: ${formatarMoeda(conta.emprestimo.valor)}).`);
        }

        // Blackjack
        if (message.content.startsWith('p!blackjack')) {
            const partes = message.content.trim().split(/\s+/);
            const conta = pegarConta(message.author.id);
            const aposta = parseValorEconomia(partes[1], conta.carteira);

            if (!Number.isInteger(aposta) || aposta <= 0) {
                return message.reply(`Use: p!blackjack (valor) ou p!blackjack tudo\nCarteira: ${formatarMoeda(conta.carteira)}`);
            }

            if (aposta > conta.carteira) {
                return message.reply(`❌ Você não tem Miracoins suficientes. Carteira: ${formatarMoeda(conta.carteira)}`);
            }

            conta.carteira -= aposta;
            salvarDados();

            const baralho = criarBaralho();
            const maoJogador = [baralho.pop(), baralho.pop()];
            const maoDealer = [baralho.pop(), baralho.pop()];

            const embedInicial = new EmbedBuilder()
                .setTitle('🃏 Blackjack')
                .setColor(0x2ECC71)
                .setDescription(
                    `Aposta: ${formatarMoeda(aposta)}\n\n` +
                    `**Sua mão:** ${formatarMao(maoJogador)} (${valorMao(maoJogador)})\n` +
                    `**Mão do dealer:** ${formatarMao([maoDealer[0]])} + 🂠\n\n` +
                    'Responda `hit` pra comprar carta ou `parar` pra ficar. (30s por jogada)'
                );

            await message.reply({ embeds: [embedInicial] });

            let jogadorParou = false;
            let estourou = false;

            while (!jogadorParou && !estourou && valorMao(maoJogador) < 21) {
                let colecionadas;
                try {
                    colecionadas = await message.channel.awaitMessages({
                        filter: m => m.author.id === message.author.id && ['hit', 'parar'].includes(m.content.trim().toLowerCase()),
                        max: 1,
                        time: 30000,
                        errors: ['time']
                    });
                } catch (_) {
                    conta.carteira += aposta;
                    salvarDados();
                    return message.channel.send('⌛ Tempo esgotado. Aposta devolvida.');
                }

                const escolha = colecionadas.first().content.trim().toLowerCase();

                if (escolha === 'hit') {
                    maoJogador.push(baralho.pop());
                    const novoValor = valorMao(maoJogador);
                    if (novoValor > 21) estourou = true;

                    await message.channel.send(
                        `**Sua mão:** ${formatarMao(maoJogador)} (${novoValor})` +
                        (estourou ? '\n💥 Estourou!' : '')
                    );
                } else {
                    jogadorParou = true;
                }
            }

            let resultado;
            const valorFinalJogador = valorMao(maoJogador);

            if (estourou) {
                resultado = `💥 Você estourou com ${valorFinalJogador} e perdeu ${formatarMoeda(aposta)}.`;
                ganharXp(conta, aposta);
            } else {
                // dealer compra até 17, e continua se for "soft 17" (17 com Ás valendo 11)
                while (valorMao(maoDealer) < 17 || maoEhMole(maoDealer)) {
                    maoDealer.push(baralho.pop());
                }
                const valorDealer = valorMao(maoDealer);

                let ganho = 0;
                if (valorDealer > 21 || valorFinalJogador > valorDealer) {
                    ganho = aposta * 2;
                } else if (valorFinalJogador === valorDealer) {
                    ganho = aposta;
                }

                const { lucro, taxa } = resolverAposta(conta, aposta, ganho);
                const subiuNivel = ganharXp(conta, aposta + Math.max(0, lucro));

                resultado =
                    `**Mão final do dealer:** ${formatarMao(maoDealer)} (${valorDealer})\n` +
                    `**Sua mão final:** ${formatarMao(maoJogador)} (${valorFinalJogador})\n\n` +
                    (lucro > 0
                        ? `🎉 Você ganhou ${formatarMoeda(lucro)} de lucro (taxa da casa: ${formatarMoeda(taxa)})!`
                        : lucro === 0
                            ? '🤝 Empate! Sua aposta foi devolvida.'
                            : `😢 Você perdeu ${formatarMoeda(aposta)}.`) +
                    (subiuNivel ? `\n🌟 Você subiu para o nível ${conta.nivel}!` : '');
            }

            salvarDados();
            return message.channel.send(resultado);
        }

        // Caça-níquel (só a trinca paga, pra diminuir a chance de ganhar)
        if (message.content.startsWith('p!cacaniquel') || message.content.startsWith('p!caçaniquel')) {
            const partes = message.content.trim().split(/\s+/);
            const conta = pegarConta(message.author.id);
            const aposta = parseValorEconomia(partes[1], conta.carteira);

            if (!Number.isInteger(aposta) || aposta <= 0) {
                return message.reply(`Use: p!cacaniquel (valor) ou p!cacaniquel tudo\nCarteira: ${formatarMoeda(conta.carteira)}`);
            }

            if (aposta > conta.carteira) {
                return message.reply(`❌ Você não tem Miracoins suficientes. Carteira: ${formatarMoeda(conta.carteira)}`);
            }

            conta.carteira -= aposta;

            const [a, b, c] = [sortearSlot(), sortearSlot(), sortearSlot()];
            const linha = `🎰 [ ${a.emoji} | ${b.emoji} | ${c.emoji} ] 🎰`;

            const multiplicador = (a.nome === b.nome && b.nome === c.nome) ? a.multiTripla : 0;
            const ganho = Math.round(aposta * multiplicador);

            const { lucro, taxa } = resolverAposta(conta, aposta, ganho);
            const subiuNivel = ganharXp(conta, aposta + Math.max(0, lucro));
            salvarDados();

            const embed = new EmbedBuilder()
                .setTitle('🎰 Caça-níquel')
                .setColor(lucro > 0 ? 0xF1C40F : 0x992D22)
                .setDescription(
                    `${linha}\n\n` +
                    (lucro > 0
                        ? `🎉 TRINCA! Ganhou ${formatarMoeda(lucro)} de lucro (taxa da casa: ${formatarMoeda(taxa)}).`
                        : `😢 Nada combinou. Perdeu ${formatarMoeda(aposta)}.`) +
                    (subiuNivel ? `\n🌟 Você subiu para o nível ${conta.nivel}!` : '')
                );

            return message.reply({ embeds: [embed] });
        }

        // Roleta
        if (message.content.startsWith('p!roleta')) {
            const partes = message.content.trim().split(/\s+/);
            const conta = pegarConta(message.author.id);
            const aposta = parseValorEconomia(partes[1], conta.carteira);
            const corEscolhida = (partes[2] || '').toLowerCase();

            if (!Number.isInteger(aposta) || aposta <= 0 || !['vermelho', 'preto', 'verde'].includes(corEscolhida)) {
                return message.reply(
                    `Use: p!roleta (valor) (vermelho|preto|verde)\nCarteira: ${formatarMoeda(conta.carteira)}`
                );
            }

            if (aposta > conta.carteira) {
                return message.reply(`❌ Você não tem Miracoins suficientes. Carteira: ${formatarMoeda(conta.carteira)}`);
            }

            conta.carteira -= aposta;

            const resultado = girarRoleta();
            const acertou = resultado.cor === corEscolhida;
            const multiplicador = acertou ? (resultado.cor === 'verde' ? MULTIPLICADOR_ROLETA_VERDE : MULTIPLICADOR_ROLETA_COR) : 0;

            const ganho = Math.round(aposta * multiplicador);
            const { lucro, taxa } = resolverAposta(conta, aposta, ganho);
            const subiuNivel = ganharXp(conta, aposta + Math.max(0, lucro));
            salvarDados();

            const emojiCor = { vermelho: '🔴', preto: '⚫', verde: '🟢' };

            const embed = new EmbedBuilder()
                .setTitle('🎡 Roleta')
                .setColor(acertou ? 0x2ECC71 : 0x992D22)
                .setDescription(
                    `A bolinha caiu no **${resultado.numero}** ${emojiCor[resultado.cor]} (${resultado.cor})\n` +
                    `Sua aposta: ${emojiCor[corEscolhida]} ${corEscolhida}\n\n` +
                    (acertou
                        ? `🎉 Acertou! Ganhou ${formatarMoeda(lucro)} de lucro (taxa da casa: ${formatarMoeda(taxa)}).`
                        : `😢 Não foi dessa vez. Perdeu ${formatarMoeda(aposta)}.`) +
                    (subiuNivel ? `\n🌟 Você subiu para o nível ${conta.nivel}!` : '')
                );

            return message.reply({ embeds: [embed] });
        }

        // Jogo da Bola (multiplayer, lobby de 30s)
        if (message.content.startsWith('p!bola')) {
            const partes = message.content.trim().split(/\s+/);
            const conta = pegarConta(message.author.id);
            const aposta = parseValorEconomia(partes[1], conta.carteira);

            if (!Number.isInteger(aposta) || aposta <= 0) {
                return message.reply(`Use: p!bola (valor)\nCarteira: ${formatarMoeda(conta.carteira)}`);
            }

            if (aposta > conta.carteira) {
                return message.reply(`❌ Você não tem Miracoins suficientes. Carteira: ${formatarMoeda(conta.carteira)}`);
            }

            const canalId = message.channel.id;
            let jogo = jogosBola.get(canalId);

            if (jogo && jogo.jogadores.has(message.author.id)) {
                return message.reply('❌ Você já está nesse jogo da bola.');
            }

            conta.carteira -= aposta;
            salvarDados();

            if (!jogo) {
                jogo = { jogadores: new Map(), timeout: null };
                jogosBola.set(canalId, jogo);
                jogo.timeout = setTimeout(() => resolverJogoBola(canalId, message.channel), TEMPO_LOBBY_BOLA);
                jogo.jogadores.set(message.author.id, { aposta, username: message.author.username });

                await message.reply(
                    `⚽ **Jogo da Bola começou!** Aposta inicial de **${message.author.username}**: ${formatarMoeda(aposta)}\n` +
                    'Outros jogadores podem entrar com `p!bola (valor)` nos próximos 30 segundos!'
                );
            } else {
                jogo.jogadores.set(message.author.id, { aposta, username: message.author.username });
                await message.reply(`⚽ **${message.author.username}** entrou no jogo da bola com ${formatarMoeda(aposta)}!`);
            }

            return;
        }

        // Corrida de Cavalos (multiplayer, lobby de 30s)
        if (message.content.startsWith('p!corrida')) {
            const partes = message.content.trim().split(/\s+/);
            const conta = pegarConta(message.author.id);
            const aposta = parseValorEconomia(partes[1], conta.carteira);
            const cavaloId = parseInt(partes[2], 10);
            const cavaloEscolhido = CAVALOS.find(c => c.id === cavaloId);

            if (!Number.isInteger(aposta) || aposta <= 0 || !cavaloEscolhido) {
                const listaCavalos = CAVALOS.map(c => `${c.id}. ${c.emoji} ${c.nome} (paga x${c.multiplicador})`).join('\n');
                return message.reply(`Use: p!corrida (valor) (número do cavalo)\n${listaCavalos}`);
            }

            if (aposta > conta.carteira) {
                return message.reply(`❌ Você não tem Miracoins suficientes. Carteira: ${formatarMoeda(conta.carteira)}`);
            }

            const canalId = message.channel.id;
            let corrida = jogosCorrida.get(canalId);

            if (corrida && corrida.apostas.has(message.author.id)) {
                return message.reply('❌ Você já apostou nessa corrida.');
            }

            conta.carteira -= aposta;
            salvarDados();

            if (!corrida) {
                corrida = { apostas: new Map(), timeout: null };
                jogosCorrida.set(canalId, corrida);
                corrida.timeout = setTimeout(() => resolverCorrida(canalId, message.channel), TEMPO_LOBBY_CORRIDA);
                corrida.apostas.set(message.author.id, { aposta, cavaloId, username: message.author.username });

                await message.reply(
                    `🏇 **Corrida de cavalos começou!** **${message.author.username}** apostou ${formatarMoeda(aposta)} no ${cavaloEscolhido.emoji} **${cavaloEscolhido.nome}**.\n` +
                    'Outros jogadores têm 30 segundos pra apostar com `p!corrida (valor) (número do cavalo)`!'
                );
            } else {
                corrida.apostas.set(message.author.id, { aposta, cavaloId, username: message.author.username });
                await message.reply(`🏇 **${message.author.username}** apostou ${formatarMoeda(aposta)} no ${cavaloEscolhido.emoji} **${cavaloEscolhido.nome}**!`);
            }

            return;
        }

        // ---------- Jogo de UNO ----------

        // Cancelar mesa de UNO (quem tá jogando, ou um moderador)
        if (message.content === 'p!uno cancelar') {
            if (!message.guild) return message.reply('❌ Esse comando só funciona dentro do servidor.');

            const jogo = jogosUno.get(message.channel.id);
            if (!jogo) return message.reply('❌ Não tem mesa de UNO nesse canal.');

            const podeCancelar = jogo.jogadores.includes(message.author.id) ||
                ehDono(message) ||
                temPermissao(message, PermissionsBitField.Flags.ManageMessages);

            if (!podeCancelar) {
                return message.reply('❌ Só quem tá jogando (ou um moderador) pode cancelar a mesa.');
            }

            jogosUno.delete(message.channel.id);
            return message.reply('🎮 Mesa de UNO cancelada.');
        }

        // Comprar uma carta (passa a vez)
        if (message.content === 'p!uno comprar') {
            if (!message.guild) return message.reply('❌ Esse comando só funciona dentro do servidor.');

            const jogo = jogosUno.get(message.channel.id);
            if (!jogo || !jogo.emAndamento) {
                return message.reply('❌ Não tem jogo de UNO em andamento nesse canal. Use `p!uno` pra abrir uma mesa.');
            }

            const userIdVez = jogo.jogadores[jogo.indiceAtual];
            if (message.author.id !== userIdVez) {
                return message.reply(`❌ Não é sua vez! É a vez de **${jogo.usernames[userIdVez]}**.`);
            }

            const [cartaComprada] = comprarCartasUno(jogo, 1);

            if (!cartaComprada) {
                await message.channel.send('🃏 O baralho acabou! Ninguém pode comprar mais cartas.');
            } else {
                jogo.maos.get(message.author.id).push(cartaComprada);
                await message.channel.send(`🃏 **${message.author.username}** comprou uma carta e passou a vez.`);
                await enviarMaoUnoPorDm(jogo, message.author.id);
            }

            jogo.indiceAtual = proximoIndiceUno(jogo, false);
            await anunciarTurnoUno(jogo, message.channel);
            return;
        }

        // Jogar uma carta da mão
        if (message.content.startsWith('p!uno jogar')) {
            // Canal onde o resultado da jogada deve ser anunciado. Dentro de servidor é o
            // próprio canal; via DM do bot, procuramos em qual servidor esse jogador tem
            // uma partida em andamento e usamos o canal real de lá.
            let canal = message.channel;

            if (!message.guild) {
                let canalIdEncontrado = null;
                for (const [id, j] of jogosUno) {
                    if (j.emAndamento && j.jogadores.includes(message.author.id)) {
                        canalIdEncontrado = id;
                        break;
                    }
                }

                if (!canalIdEncontrado) {
                    return message.reply('❌ Você não está em nenhuma partida de UNO em andamento em nenhum servidor.');
                }

                const canalReal = client.channels.cache.get(canalIdEncontrado);
                if (!canalReal) {
                    return message.reply('❌ Não consegui encontrar o canal do servidor onde sua partida está rolando.');
                }

                canal = canalReal;
            }

            const jogo = jogosUno.get(canal.id);
            if (!jogo || !jogo.emAndamento) {
                return message.reply(`❌ Não tem jogo de UNO em andamento ${message.guild ? 'nesse canal' : 'nesse servidor'}. Use \`p!uno\` pra abrir uma mesa.`);
            }

            const userIdVez = jogo.jogadores[jogo.indiceAtual];
            if (message.author.id !== userIdVez) {
                return message.reply(`❌ Não é sua vez! É a vez de **${jogo.usernames[userIdVez]}**.`);
            }

            const partes = message.content.trim().split(/\s+/);
            const indiceCarta = parseInt(partes[2], 10);
            const corEscolhida = (partes[3] || '').toLowerCase();
            const mao = jogo.maos.get(message.author.id);

            if (!Number.isInteger(indiceCarta) || indiceCarta < 1 || indiceCarta > mao.length) {
                return message.reply('Use: p!uno jogar <número da carta> [cor, se for curinga] — veja os números na sua DM.');
            }

            const carta = mao[indiceCarta - 1];
            const topo = jogo.descarte[jogo.descarte.length - 1];

            if (!cartaJogavelUno(carta, topo, jogo.corAtual)) {
                return message.reply(`❌ Essa carta não combina com o topo (${formatarCartaUno(topo)}, cor atual ${formatarCorAtualUno(jogo.corAtual)}).`);
            }

            if (!carta.cor && !['vermelho', 'azul', 'verde', 'amarelo'].includes(corEscolhida)) {
                return message.reply('Use: p!uno jogar <número> <vermelho|azul|verde|amarelo> — precisa escolher a cor pro curinga.');
            }

            mao.splice(indiceCarta - 1, 1);
            jogo.descarte.push(carta);
            jogo.corAtual = carta.cor || corEscolhida;

            // Se a jogada veio de DM, confirma discretamente pro jogador que ela foi enviada pro servidor
            if (!message.guild) {
                await message.reply('✅ Jogada enviada pro servidor!').catch(() => {});
            }

            const avisoCorEscolhida = !carta.cor ? ` (escolheu ${formatarCorAtualUno(jogo.corAtual)})` : '';
            await canal.send(`🃏 **${message.author.username}** jogou ${formatarCartaUno(carta)}!${avisoCorEscolhida}`);

            if (mao.length === 0) {
                jogosUno.delete(canal.id);
                return canal.send(`🏆 **${message.author.username}** ganhou o UNO! 🎉`);
            }

            if (mao.length === 1) {
                await canal.send(`🚨 **${message.author.username}** ficou com **UNO!** (1 carta)`);
            }

            let pular = false;

            if (carta.valor === 'pular') {
                pular = true;
            } else if (carta.valor === 'reverter') {
                jogo.direcao *= -1;
                if (jogo.jogadores.length === 2) pular = true; // com 2 jogadores, reverter = pular
            } else if (carta.valor === '+2') {
                const proximoId = jogo.jogadores[proximoIndiceUno(jogo, false)];
                jogo.maos.get(proximoId).push(...comprarCartasUno(jogo, 2));
                await canal.send(`➕ **${jogo.usernames[proximoId]}** comprou 2 cartas e perde a vez!`);
                await enviarMaoUnoPorDm(jogo, proximoId); // manda a mão atualizada na hora, sem esperar a vez dele(a)
                pular = true;
            } else if (carta.valor === '+4') {
                const proximoId = jogo.jogadores[proximoIndiceUno(jogo, false)];
                jogo.maos.get(proximoId).push(...comprarCartasUno(jogo, 4));
                await canal.send(`➕ **${jogo.usernames[proximoId]}** comprou 4 cartas e perde a vez!`);
                await enviarMaoUnoPorDm(jogo, proximoId); // manda a mão atualizada na hora, sem esperar a vez dele(a)
                pular = true;
            }

            jogo.indiceAtual = proximoIndiceUno(jogo, pular);
            await anunciarTurnoUno(jogo, canal);
            return;
        }

        // Abrir mesa / entrar na mesa de UNO
        if (message.content === 'p!uno') {
            if (!message.guild) return message.reply('❌ Esse comando só funciona dentro do servidor.');

            const canalId = message.channel.id;
            const jogoExistente = jogosUno.get(canalId);

            if (jogoExistente && jogoExistente.emAndamento) {
                return message.reply('❌ Já tem um jogo de UNO em andamento nesse canal. Espere terminar ou use `p!uno cancelar`.');
            }

            if (jogoExistente && jogoExistente.emLobby) {
                if (jogoExistente.jogadores.includes(message.author.id)) {
                    return message.reply('❌ Você já entrou nessa mesa de UNO.');
                }

                if (jogoExistente.jogadores.length >= MAX_JOGADORES_UNO) {
                    return message.reply(`❌ A mesa de UNO já está cheia (máximo ${MAX_JOGADORES_UNO} jogadores).`);
                }

                jogoExistente.jogadores.push(message.author.id);
                jogoExistente.usernames[message.author.id] = message.author.username;

                return message.channel.send(`🎮 **${message.author.username}** entrou na mesa de UNO! (${jogoExistente.jogadores.length} jogadores)`);
            }

            const jogo = {
                emLobby: true,
                emAndamento: false,
                jogadores: [message.author.id],
                usernames: { [message.author.id]: message.author.username },
                maos: new Map(),
                baralho: [],
                descarte: [],
                corAtual: null,
                indiceAtual: 0,
                direcao: 1
            };

            jogosUno.set(canalId, jogo);

            await message.channel.send(
                `🎮 **${message.author.username}** abriu uma mesa de UNO!\n` +
                `Outros jogadores podem entrar com \`p!uno\` nos próximos 30 segundos! (mínimo 2, máximo ${MAX_JOGADORES_UNO})`
            );

            setTimeout(() => iniciarJogoUno(canalId, message.channel), TEMPO_LOBBY_UNO);
            return;
        }

        // ---------- Comandos de donos ----------

        // Adicionar Miracoins pra uma pessoa
        if (message.content.startsWith('p!addmoney') && !message.content.startsWith('p!addmoneytodos')) {
            if (!ehDono(message)) {
                return message.reply('❌ Apenas donos podem usar esse comando.');
            }

            const partes = message.content.trim().split(/\s+/);
            const alvo = message.mentions.users.first();
            const valor = parseInt(partes[partes.length - 1], 10);

            if (!alvo || !Number.isInteger(valor) || valor <= 0) {
                return message.reply('Use: p!addmoney @pessoa (valor)');
            }

            const conta = pegarConta(alvo.id);
            conta.carteira += valor;
            salvarDados();

            return message.reply(`✅ Adicionado ${formatarMoeda(valor)} pra **${alvo.username}**. Novo saldo: ${formatarMoeda(conta.carteira)}`);
        }

        // Adicionar Miracoins pra todo mundo que já tem conta registrada
        if (message.content.startsWith('p!addmoneytodos')) {
            if (!ehDono(message)) {
                return message.reply('❌ Apenas donos podem usar esse comando.');
            }

            const partes = message.content.trim().split(/\s+/);
            const valor = parseInt(partes[1], 10);

            if (!Number.isInteger(valor) || valor <= 0) {
                return message.reply('Use: p!addmoneytodos (valor)');
            }

            const ids = Object.keys(economia);
            for (const id of ids) {
                pegarConta(id).carteira += valor;
            }
            salvarDados();

            return message.reply(`✅ Adicionado ${formatarMoeda(valor)} pra todo mundo (${ids.length} conta(s) registrada(s)).`);
        }

        // Remover Miracoins de uma pessoa
        if (message.content.startsWith('p!removemoney')) {
            if (!ehDono(message)) {
                return message.reply('❌ Apenas donos podem usar esse comando.');
            }

            const partes = message.content.trim().split(/\s+/);
            const alvo = message.mentions.users.first();
            const valor = parseInt(partes[partes.length - 1], 10);

            if (!alvo || !Number.isInteger(valor) || valor <= 0) {
                return message.reply('Use: p!removemoney @pessoa (valor)');
            }

            const conta = pegarConta(alvo.id);
            conta.carteira = Math.max(0, conta.carteira - valor);
            salvarDados();

            return message.reply(`✅ Removido ${formatarMoeda(valor)} de **${alvo.username}**. Novo saldo: ${formatarMoeda(conta.carteira)}`);
        }

        // Aluguel
        if (message.content.startsWith('p!aluguel')) {
            if (!ehDono(message)) {
                return message.reply('❌ Apenas donos podem usar esse comando.');
            }

            const partes = message.content.trim().split(/\s+/);
            const valor = parseInt(partes[1], 10);
            const alvo = message.mentions.users.first();

            if (!Number.isInteger(valor) || valor <= 0 || !alvo) {
                return message.reply('Use: p!aluguel (valor) @pessoa');
            }

            const conta = pegarConta(alvo.id);
            const cobrado = Math.min(valor, conta.carteira);
            conta.carteira -= cobrado;
            impostoArrecadado += cobrado;
            salvarDados();

            return message.reply(
                `🏠 Cobrado ${formatarMoeda(cobrado)} de aluguel de **${alvo.username}**` +
                (cobrado < valor ? ' (não tinha o valor completo, cobramos o que dava).' : '.') +
                `\nSaldo de **${alvo.username}**: ${formatarMoeda(conta.carteira)}`
            );
        }

        // Cobrar imposto de uma pessoa específica
        if (message.content.startsWith('p!cobrarimposto')) {
            if (!ehDono(message)) {
                return message.reply('❌ Apenas donos podem usar esse comando.');
            }

            const partes = message.content.trim().split(/\s+/);
            const valor = parseInt(partes[1], 10);
            const alvo = message.mentions.users.first();

            if (!Number.isInteger(valor) || valor <= 0 || !alvo) {
                return message.reply('Use: p!cobrarimposto (valor) @pessoa');
            }

            const conta = pegarConta(alvo.id);
            const cobrado = Math.min(valor, conta.carteira);
            conta.carteira -= cobrado;
            impostoArrecadado += cobrado;
            salvarDados();

            return message.reply(
                `🏛️ Cobrado ${formatarMoeda(cobrado)} de imposto de **${alvo.username}**` +
                (cobrado < valor ? ' (não tinha o valor completo).' : '.') +
                `\nSaldo de **${alvo.username}**: ${formatarMoeda(conta.carteira)}`
            );
        }

        // Cobrar imposto de TODO MUNDO
        if (message.content.startsWith('p!impostogeral')) {
            if (!ehDono(message)) {
                return message.reply('❌ Apenas donos podem usar esse comando.');
            }

            const partes = message.content.trim().split(/\s+/);
            const valor = parseInt(partes[1], 10);

            if (!Number.isInteger(valor) || valor <= 0) {
                return message.reply('Use: p!impostogeral (valor) — cobra esse valor (ou o que a pessoa tiver) de todo mundo');
            }

            const ids = Object.keys(economia);
            let totalArrecadado = 0;

            for (const id of ids) {
                const conta = pegarConta(id);
                const cobrado = Math.min(valor, conta.carteira);
                conta.carteira -= cobrado;
                totalArrecadado += cobrado;
            }

            impostoArrecadado += totalArrecadado;
            salvarDados();

            return message.reply(`🏛️ Cobrado um total de ${formatarMoeda(totalArrecadado)} de ${ids.length} conta(s) e adicionado ao imposto arrecadado.`);
        }

        // Ver imposto arrecadado
        if (message.content === 'p!imposto') {
            if (!ehDono(message)) {
                return message.reply('❌ Apenas donos podem ver isso.');
            }

            return message.reply(`🏛️ Imposto arrecadado atualmente: ${formatarMoeda(impostoArrecadado)}`);
        }

        // Sacar imposto arrecadado (pode escolher o valor, ou sacar tudo)
        if (message.content === 'p!pegarimposto' || message.content.startsWith('p!pegarimposto ')) {
            if (!ehDono(message)) {
                return message.reply('❌ Apenas donos podem usar esse comando.');
            }

            if (impostoArrecadado <= 0) {
                return message.reply('💤 Não há imposto arrecadado no momento.');
            }

            const partes = message.content.trim().split(/\s+/);
            const valorPedido = parseValorEconomia(partes[1], impostoArrecadado);
            const valor = (Number.isInteger(valorPedido) && valorPedido > 0)
                ? Math.min(valorPedido, impostoArrecadado)
                : impostoArrecadado;

            const conta = pegarConta(message.author.id);
            conta.carteira += valor;
            impostoArrecadado -= valor;
            salvarDados();

            return message.reply(`💰 Você sacou ${formatarMoeda(valor)} do imposto arrecadado. Restante no fundo: ${formatarMoeda(impostoArrecadado)}`);
        }

        // Adicionar nível manualmente
        if (message.content.startsWith('p!addlevel')) {
            if (!ehDono(message)) {
                return message.reply('❌ Apenas donos podem usar esse comando.');
            }

            const partes = message.content.trim().split(/\s+/);
            const alvo = message.mentions.users.first();
            const quantidade = parseInt(partes[partes.length - 1], 10);

            if (!alvo || !Number.isInteger(quantidade) || quantidade <= 0) {
                return message.reply('Use: p!addlevel @pessoa (quantidade)');
            }

            const conta = pegarConta(alvo.id);
            conta.nivel += quantidade;
            salvarDados();

            return message.reply(`✅ **${alvo.username}** subiu ${quantidade} nível(is). Nível atual: ${conta.nivel}`);
        }

        // Remover nível manualmente
        if (message.content.startsWith('p!removelevel')) {
            if (!ehDono(message)) {
                return message.reply('❌ Apenas donos podem usar esse comando.');
            }

            const partes = message.content.trim().split(/\s+/);
            const alvo = message.mentions.users.first();
            const quantidade = parseInt(partes[partes.length - 1], 10);

            if (!alvo || !Number.isInteger(quantidade) || quantidade <= 0) {
                return message.reply('Use: p!removelevel @pessoa (quantidade)');
            }

            const conta = pegarConta(alvo.id);
            conta.nivel = Math.max(1, conta.nivel - quantidade);
            salvarDados();

            return message.reply(`✅ **${alvo.username}** perdeu ${quantidade} nível(is). Nível atual: ${conta.nivel}`);
        }

        // IA
        if (message.content.startsWith('p!perguntar ')) {

            const pergunta = message.content
                .slice(12)
                .trim();

            if (!pergunta) {
                return message.reply('❌ Faça uma pergunta.');
            }

            const resposta = await fetch(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization':
                            `Bearer ${process.env.GROQ_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: 'openai/gpt-oss-120b',
                        messages: [
                            {
                                role: 'system',
                                content:
                                    'Você é um assistente útil. Responda em português do Brasil. Seja breve, direto e claro. Evite respostas longas, se perguntarem nunca diga que voce e o chat gpt, diga que e o sr pimbolinhas, nunca diga isso se alguem não perguntar, se perguntarem sobre um einyx diga que ele e seu dono, ele e sua pessoa favorita independente de tudo.'
                            },
                            {
                                role: 'user',
                                content: pergunta
                            }
                        ],
                        temperature: 0.7,
                        max_tokens: 300
                    })
                }
            );

            const data = await resposta.json();

            if (!resposta.ok) {
                console.log(data);
                return message.reply(
                    '❌ Erro ao consultar a IA.'
                );
            }

            const texto =
                data.choices?.[0]?.message?.content ||
                'Não consegui responder.';

            return message.reply(
                texto.substring(0, 1900)
            );
        }

    } catch (erro) {
        console.error('Erro ao processar comando:', erro);
        try {
            await message.reply('❌ Deu ruim aqui, tenta de novo mais tarde.');
        } catch (_) {
            // se nem isso funcionar, só loga e segue a vida
        }
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    await processarComando(message);
});

// ---------- Slash commands (funcionam em DM e grupo de DM, além do servidor) ----------
// Cada comando de economia/diversão ganha uma versão em slash command. Em vez de reescrever
// a lógica de cada um, a gente monta uma "mensagem falsa" com o mesmo formato de texto que o
// comando de prefixo (`p!...`) esperaria, e reaproveita o `processarComando` já existente.

// Constrói uma Collection de menções (imitando message.mentions.users) a partir
// dos usuários escolhidos nas opções do slash command.
function construirMencoes(...usuarios) {
    const colecao = new Collection();
    for (const usuario of usuarios) {
        if (usuario) colecao.set(usuario.id, usuario);
    }
    return colecao;
}

const DEFINICOES_SLASH = [
    {
        data: new SlashCommandBuilder().setName('ajuda').setDescription('Mostra a lista de comandos do bot.'),
        montar: () => ({ conteudo: 'p!ajuda' })
    },
    {
        data: new SlashCommandBuilder().setName('escolher').setDescription('Sorteia uma opção entre várias.')
            .addStringOption(o => o.setName('opcoes').setDescription('Opções separadas por | (ex: gato | cachorro)').setRequired(true)),
        montar: (i) => ({ conteudo: `p!escolher ${i.options.getString('opcoes')}` })
    },
    {
        data: new SlashCommandBuilder().setName('dado').setDescription('Rola um dado.')
            .addIntegerOption(o => o.setName('lados').setDescription('Número de lados (padrão: 6)').setMinValue(2)),
        montar: (i) => ({ conteudo: `p!dado ${i.options.getInteger('lados') || ''}`.trim() })
    },
    {
        data: new SlashCommandBuilder().setName('moeda').setDescription('Cara ou coroa.'),
        montar: () => ({ conteudo: 'p!moeda' })
    },
    {
        data: new SlashCommandBuilder().setName('8ball').setDescription('Pergunte pra bola 8 mágica.')
            .addStringOption(o => o.setName('pergunta').setDescription('Sua pergunta').setRequired(true)),
        montar: (i) => ({ conteudo: `p!8ball ${i.options.getString('pergunta')}` })
    },
    {
        data: new SlashCommandBuilder().setName('ship').setDescription('Compatibilidade entre duas pessoas.')
            .addUserOption(o => o.setName('pessoa1').setDescription('Primeira pessoa'))
            .addUserOption(o => o.setName('pessoa2').setDescription('Segunda pessoa')),
        montar: (i) => ({ conteudo: 'p!ship', mencionados: [i.options.getUser('pessoa1'), i.options.getUser('pessoa2')] })
    },
    {
        data: new SlashCommandBuilder().setName('gay').setDescription('Porcentagem aleatória boba (só brincadeira).')
            .addUserOption(o => o.setName('pessoa').setDescription('Quem sortear (padrão: você)')),
        montar: (i) => ({ conteudo: 'p!gay', mencionados: [i.options.getUser('pessoa')] })
    },
    {
        data: new SlashCommandBuilder().setName('fato').setDescription('Um fato curioso aleatório.'),
        montar: () => ({ conteudo: 'p!fato' })
    },
    {
        data: new SlashCommandBuilder().setName('dica').setDescription('Uma dica aleatória.'),
        montar: () => ({ conteudo: 'p!dica' })
    },
    {
        data: new SlashCommandBuilder().setName('gato').setDescription('Uma imagem aleatória de gato.'),
        montar: () => ({ conteudo: 'p!gato' })
    },
    {
        data: new SlashCommandBuilder().setName('perfil').setDescription('Mostra o perfil de economia de alguém.')
            .addUserOption(o => o.setName('usuario').setDescription('Quem ver (padrão: você)')),
        montar: (i) => ({ conteudo: 'p!perfil', mencionados: [i.options.getUser('usuario')] })
    },
    {
        data: new SlashCommandBuilder().setName('casar').setDescription('Pede alguém em casamento.')
            .addUserOption(o => o.setName('pessoa').setDescription('Com quem casar').setRequired(true)),
        montar: (i) => ({ conteudo: 'p!casar', mencionados: [i.options.getUser('pessoa')] })
    },
    {
        data: new SlashCommandBuilder().setName('divorciar').setDescription('Termina seu casamento atual.'),
        montar: () => ({ conteudo: 'p!divorciar' })
    },
    {
        data: new SlashCommandBuilder().setName('loja').setDescription('Abre a loja do servidor.'),
        montar: () => ({ conteudo: 'p!loja' })
    },
    {
        data: new SlashCommandBuilder().setName('comprar').setDescription('Compra um item da loja.')
            .addStringOption(o => o.setName('item').setDescription('Tipo do item').setRequired(true)
                .addChoices(
                    { name: 'Título', value: 'titulo' },
                    { name: 'Anel de noivado', value: 'anel' },
                    { name: 'Miraculous', value: 'miraculous' },
                    { name: 'Cargo VIP', value: 'vip' },
                    { name: 'Emoji personalizado', value: 'emoji' }
                ))
            .addStringOption(o => o.setName('argumento').setDescription('ID do item, ou nome/cor no caso do VIP/emoji')),
        montar: (i) => ({ conteudo: `p!comprar ${i.options.getString('item')} ${i.options.getString('argumento') || ''}`.trim() })
    },
    {
        data: new SlashCommandBuilder().setName('titulo').setDescription('Equipa ou remove um título comprado.')
            .addStringOption(o => o.setName('id').setDescription('ID do título, ou "remover"')),
        montar: (i) => ({ conteudo: `p!titulo ${i.options.getString('id') || ''}`.trim() })
    },
    {
        data: new SlashCommandBuilder().setName('trabalhar').setDescription('Trabalha pra ganhar Miracoins.'),
        montar: () => ({ conteudo: 'p!trabalhar' })
    },
    {
        data: new SlashCommandBuilder().setName('crime').setDescription('Tenta um crime por Miracoins (risco de multa).'),
        montar: () => ({ conteudo: 'p!crime' })
    },
    {
        data: new SlashCommandBuilder().setName('diario').setDescription('Recompensa diária de Miracoins.'),
        montar: () => ({ conteudo: 'p!diario' })
    },
    {
        data: new SlashCommandBuilder().setName('depositar').setDescription('Deposita Miracoins no banco.')
            .addStringOption(o => o.setName('valor').setDescription('Valor, ou "tudo"').setRequired(true)),
        montar: (i) => ({ conteudo: `p!depositar ${i.options.getString('valor')}` })
    },
    {
        data: new SlashCommandBuilder().setName('sacar').setDescription('Saca Miracoins do banco.')
            .addStringOption(o => o.setName('valor').setDescription('Valor, ou "tudo"').setRequired(true)),
        montar: (i) => ({ conteudo: `p!sacar ${i.options.getString('valor')}` })
    },
    {
        data: new SlashCommandBuilder().setName('transferir').setDescription('Transfere Miracoins pra alguém.')
            .addUserOption(o => o.setName('pessoa').setDescription('Pra quem transferir').setRequired(true))
            .addStringOption(o => o.setName('valor').setDescription('Valor, ou "tudo"').setRequired(true)),
        montar: (i) => ({
            conteudo: `p!transferir <@${i.options.getUser('pessoa').id}> ${i.options.getString('valor')}`,
            mencionados: [i.options.getUser('pessoa')]
        })
    },
    {
        data: new SlashCommandBuilder().setName('cobrar').setDescription('Cobra Miracoins de alguém (precisa aceitar).')
            .addUserOption(o => o.setName('pessoa').setDescription('De quem cobrar').setRequired(true))
            .addStringOption(o => o.setName('valor').setDescription('Valor').setRequired(true)),
        montar: (i) => ({
            conteudo: `p!cobrar <@${i.options.getUser('pessoa').id}> ${i.options.getString('valor')}`,
            mencionados: [i.options.getUser('pessoa')]
        })
    },
    {
        data: new SlashCommandBuilder().setName('emprestimo').setDescription('Pega um empréstimo do imposto arrecadado.')
            .addIntegerOption(o => o.setName('valor').setDescription('Valor do empréstimo').setRequired(true).setMinValue(1)),
        montar: (i) => ({ conteudo: `p!emprestimo ${i.options.getInteger('valor')}` })
    },
    {
        data: new SlashCommandBuilder().setName('pagar').setDescription('Paga seu empréstimo ativo.')
            .addStringOption(o => o.setName('valor').setDescription('Valor, ou "tudo"').setRequired(true)),
        montar: (i) => ({ conteudo: `p!pagar ${i.options.getString('valor')}` })
    },
    {
        data: new SlashCommandBuilder().setName('divida').setDescription('Mostra sua dívida de empréstimo atual.'),
        montar: () => ({ conteudo: 'p!divida' })
    },
    {
        data: new SlashCommandBuilder().setName('blackjack').setDescription('Joga blackjack contra o bot.')
            .addStringOption(o => o.setName('valor').setDescription('Valor da aposta, ou "tudo"').setRequired(true)),
        montar: (i) => ({ conteudo: `p!blackjack ${i.options.getString('valor')}` })
    },
    {
        data: new SlashCommandBuilder().setName('cacaniquel').setDescription('Joga no caça-níquel.')
            .addStringOption(o => o.setName('valor').setDescription('Valor da aposta, ou "tudo"').setRequired(true)),
        montar: (i) => ({ conteudo: `p!cacaniquel ${i.options.getString('valor')}` })
    },
    {
        data: new SlashCommandBuilder().setName('roleta').setDescription('Aposta na roleta.')
            .addStringOption(o => o.setName('valor').setDescription('Valor da aposta, ou "tudo"').setRequired(true))
            .addStringOption(o => o.setName('cor').setDescription('Cor escolhida').setRequired(true)
                .addChoices({ name: 'Vermelho', value: 'vermelho' }, { name: 'Preto', value: 'preto' }, { name: 'Verde', value: 'verde' })),
        montar: (i) => ({ conteudo: `p!roleta ${i.options.getString('valor')} ${i.options.getString('cor')}` })
    },
    {
        data: new SlashCommandBuilder().setName('bola').setDescription('Entra no Jogo da Bola (multiplayer).')
            .addStringOption(o => o.setName('valor').setDescription('Valor da aposta, ou "tudo"').setRequired(true)),
        montar: (i) => ({ conteudo: `p!bola ${i.options.getString('valor')}` })
    },
    {
        data: new SlashCommandBuilder().setName('corrida').setDescription('Entra na Corrida de Cavalos (multiplayer).')
            .addStringOption(o => o.setName('valor').setDescription('Valor da aposta, ou "tudo"').setRequired(true))
            .addIntegerOption(o => o.setName('cavalo').setDescription('Número do cavalo').setRequired(true).setMinValue(1)),
        montar: (i) => ({ conteudo: `p!corrida ${i.options.getString('valor')} ${i.options.getInteger('cavalo')}` })
    }
];

// Registra os slash commands globalmente, liberados tanto pra quem instala o bot
// num servidor quanto pra quem instala na própria conta (funciona em DM e grupo de DM).
async function registrarSlashCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

        const corpo = DEFINICOES_SLASH.map(({ data }) => {
            const json = data.toJSON();
            json.integration_types = [0, 1]; // 0 = instalado no servidor, 1 = instalado na conta do usuário
            json.contexts = [0, 1, 2];        // 0 = servidor, 1 = DM com o bot, 2 = DM/grupo entre usuários
            return json;
        });

        await rest.put(Routes.applicationCommands(client.application.id), { body: corpo });
        console.log(`✅ ${corpo.length} slash commands registrados (funcionam em servidor, DM e grupo de DM).`);
    } catch (erro) {
        console.error('Erro ao registrar slash commands:', erro);
    }
}

client.once('ready', () => {
    registrarSlashCommands();
});

client.on('interactionCreate', async (interacao) => {
    if (!interacao.isChatInputCommand()) return;

    const definicao = DEFINICOES_SLASH.find(d => d.data.name === interacao.commandName);
    if (!definicao) return;

    try {
        const { conteudo, mencionados = [] } = definicao.montar(interacao);

        // Fora de servidor (DM ou grupo de DM entre usuários, "User App"), o bot não tem
        // acesso ao canal via gateway — channel.send falha silenciosamente nesse contexto.
        // A única forma de responder ali é pelos próprios métodos da interação
        // (reply/editReply/followUp). Dentro de servidor, mantemos o fluxo antigo
        // (ephemeral ✅ + mensagem normal no canal), que já funciona.
        if (interacao.guild) {
            await interacao.reply({ content: '✅', ephemeral: true }).catch(() => {});

            const mensagemFalsa = {
                author: interacao.user,
                content: conteudo,
                guild: interacao.guild,
                member: interacao.member || null,
                channel: interacao.channel,
                mentions: { users: construirMencoes(...mencionados) },
                reply: (payload) => interacao.channel.send(payload),
                delete: async () => {}
            };

            await processarComando(mensagemFalsa);
        } else {
            await interacao.deferReply();

            let primeiraResposta = true;
            const enviarResposta = async (payload) => {
                if (primeiraResposta) {
                    primeiraResposta = false;
                    return interacao.editReply(payload);
                }
                return interacao.followUp(payload);
            };

            const canalFalso = {
                id: interacao.channelId,
                send: enviarResposta
            };

            const mensagemFalsa = {
                author: interacao.user,
                content: conteudo,
                guild: null,
                member: null,
                channel: canalFalso,
                mentions: { users: construirMencoes(...mencionados) },
                reply: enviarResposta,
                delete: async () => {}
            };

            await processarComando(mensagemFalsa);
        }
    } catch (erro) {
        console.error('Erro ao processar slash command:', erro);
        try {
            if (interacao.deferred || interacao.replied) {
                await interacao.followUp('❌ Deu ruim aqui, tenta de novo mais tarde.');
            } else {
                await interacao.reply('❌ Deu ruim aqui, tenta de novo mais tarde.');
            }
        } catch (_) {}
    }
});

client.login(process.env.TOKEN);
