require('dotenv').config();
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
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

process.on('unhandledRejection', (erro) => {
    console.error('Erro não tratado (unhandledRejection):', erro);
});

process.on('uncaughtException', (erro) => {
    console.error('Erro não tratado (uncaughtException):', erro);
});

client.on('error', (erro) => {
    console.error('Erro do client Discord:', erro);
});

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
            ).catch(() => {});

            await member.kick('Conta com menos de 7 dias de criação').catch((erro) => {
                console.error('Erro ao remover conta recente do servidor:', erro);
            });
        }
    } catch (erro) {
        console.error('Erro ao checar idade da conta no guildMemberAdd:', erro);
    }
});

client.once('clientReady', () => {
    console.log(`${client.user.tag} online`);

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
                    sessao.janelaAberta = false;

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

function pegarAlvo(message) {
    const mencionado = message.mentions.users.first();
    return mencionado || message.author;
}

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

const OWNER_IDS = (process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

function ehDono(message) {
    return OWNER_IDS.includes(message.author.id);
}

function parseDuracaoMs(str) {
    const match = (str || '').trim().match(/^(\d+)\s*(s|m|h|d)$/i);
    if (!match) return null;

    const multiplicadores = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return parseInt(match[1], 10) * multiplicadores[match[2].toLowerCase()];
}

const TAXA_CASA = 0.30;

const CUSTO_CASAMENTO = 25000;
const GIF_CASAMENTO = 'https://klipy.com/gifs/spy-x-family-loid-forger-16';

const XP_POR_NIVEL = 5000;

const PRAZO_EMPRESTIMO_MS = 2 * 24 * 60 * 60 * 1000;
const JUROS_EMPRESTIMO = 0.20; // 20% por período de 2 dias em atraso

// Preços pensados considerando que a maioria dos membros tem uns 1000 de
// saldo mínimo e que o casamento (item mais caro que já existia) custa 25k.
const PRECO_VIP = 15000;    // cargo VIP com nome e cor escolhidos pelo próprio membro
const PRECO_EMOJI = 20000;  // emoji personalizado adicionado ao servidor
const PRECO_ANEL = 35000;   // anel de noivado — funde a conta com a do cônjuge

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

const TRABALHO_COOLDOWN_MS = 60 * 60 * 1000; // 1h
const TRABALHO_MIN = 100;
const TRABALHO_MAX = 400;

const CRIME_COOLDOWN_MS = 45 * 60 * 1000; // 45min
const CRIME_CHANCE_SUCESSO = 0.40; // 40% de chance de dar certo
const CRIME_GANHO_MIN = 500;
const CRIME_GANHO_MAX = 1500;
const CRIME_MULTA_MIN = 400;
const CRIME_MULTA_MAX = 1800;

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

async function executarCompraDireta(ctx, item) {
    if (item.tipo === 'anel') return executarCompraAnel(ctx);
    if (item.tipo === 'titulo') return executarCompraTitulo(ctx, item.idItem);
    if (item.tipo === 'miraculous') return executarCompraMiraculous(ctx, item.idItem);
    return ctx.responderErro('❌ Esse item não pode ser comprado direto pelo botão.');
}

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

const COMANDOS_PODERES_MIRACULOUS = [
    'p!talisma', 'p!cataclismo', 'p!sentimonstro', 'p!miragem', 'p!ferroada',
    'p!protecao', 'p!viajar', 'p!segunda-chance', 'p!segundachance', 'p!resistencia',
    'p!pega', 'p!pega!', 'p!colisao', 'p!libertar', 'p!genesis'
];

function ehComandoDePoder(conteudo) {
    return comandoBate(conteudo, ...COMANDOS_PODERES_MIRACULOUS);
}

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

function temMiraculous(conta, id) {
    return conta.miraculousComprados.includes(id);
}

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

function formatarTempoRestante(ms) {
    const totalSegundos = Math.max(1, Math.ceil(ms / 1000));
    const minutos = Math.floor(totalSegundos / 60);
    const segundos = totalSegundos % 60;
    if (minutos > 0) return `${minutos}min${segundos > 0 ? ` ${segundos}s` : ''}`;
    return `${segundos}s`;
}

function pegarCooldownRestante(message, conta, id) {
    if (ehDono(message)) return 0;

    const cooldownMs = COOLDOWN_PODERES_MS[id] || 0;
    if (cooldownMs === 0) return 0;

    if (!conta.cooldownsPoderes) conta.cooldownsPoderes = {};

    const ultimoUso = conta.cooldownsPoderes[id] || 0;
    const passou = Date.now() - ultimoUso;

    return passou < cooldownMs ? cooldownMs - passou : 0;
}

function registrarUsoPoder(conta, id) {
    if (!conta.cooldownsPoderes) conta.cooldownsPoderes = {};
    conta.cooldownsPoderes[id] = Date.now();
}

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

function calcularNivel(xp) {
    return 1 + Math.floor(xp / XP_POR_NIVEL);
}

function ganharXp(conta, quantidade) {
    if (quantidade <= 0) return false;
    conta.xp += Math.round(quantidade);
    const novoNivel = calcularNivel(conta.xp);
    const subiu = novoNivel > conta.nivel;
    conta.nivel = novoNivel;
    return subiu;
}

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

function parseValorEconomia(texto, saldoDisponivel) {
    if (!texto) return NaN;
    const t = texto.trim().toLowerCase();
    if (t === 'tudo' || t === 'all') return saldoDisponivel;
    const valor = parseInt(t.replace(/\./g, ''), 10);
    return Number.isInteger(valor) ? valor : NaN;
}

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

function girarRoleta() {
    const numero = Math.floor(Math.random() * POSICOES_ROLETA.length);
    return { numero, cor: POSICOES_ROLETA[numero] };
}

const MULTIPLICADOR_ROLETA_COR = 1.8;
const MULTIPLICADOR_ROLETA_VERDE = 12;

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

async function processarComando(message) {

    try {

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

                const CANAL_PROIBIDO_COMANDOS = '1524910258856923148';
        if (message.channel.id === CANAL_PROIBIDO_COMANDOS && message.content.startsWith('p!') && !ehDono(message) && !ehComandoDePoder(message.content)) {
            message.delete().catch(() => {});
            message.channel.send('🚫 Comandos não são permitidos nesse canal.')
                .then(aviso => setTimeout(() => aviso.delete().catch(() => {}), 5000))
                .catch(() => {});
            return;
        }

                if (ehComandoDePoder(message.content) && message.channel.id !== CANAL_PODERES_MIRACULOUS && !ehDono(message)) {
            return message.reply(`❌ Os poderes dos Miraculous só podem ser usados em <#${CANAL_PODERES_MIRACULOUS}>.`);
        }

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

async function registrarSlashCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

        const corpo = DEFINICOES_SLASH.map(({ data }) => {
            const json = data.toJSON();
            json.integration_types = [0, 1];
            json.contexts = [0, 1, 2];
            return json;
        });

        await rest.put(Routes.applicationCommands(client.application.id), { body: corpo });
        console.log(`${corpo.length} slash commands registrados (funcionam em servidor, DM e grupo de DM).`);
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
