require('dotenv').config();
console.log('Tamanho do TOKEN:72', process.env.TOKEN?.length);
console.log('Primeiro/último char (código):', process.env.TOKEN?.charCodeAt(0), process.env.TOKEN?.charCodeAt(process.env.TOKEN.length - 1));
const fs = require('fs');
const path = require('path');

const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    EmbedBuilder,
    ChannelType
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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ]
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
            diarioUltimo: 0
        };
    }
    // garante que contas antigas (criadas antes dessas mudanças) tenham os campos novos
    const conta = economia[userId];
    if (conta.xp === undefined) conta.xp = 0;
    if (conta.emprestimo === undefined) conta.emprestimo = null;
    if (conta.diarioStreak === undefined) conta.diarioStreak = 0;
    if (conta.diarioUltimo === undefined) conta.diarioUltimo = 0;
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
        faltasSessao: {}
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
            faltasSessao
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

        const canalAviso = await client.channels.fetch(CANAL_AVISO_PRESENCA).catch(() => null);

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
                        }).catch(() => {});
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
    const fatos = [
        'Polvos têm três corações e sangue azul.',
        'Mel nunca estraga — arqueólogos já encontraram potes de mel comestíveis com milhares de anos.',
        'Um dia em Vênus é mais longo que um ano em Vênus.',
        'Bananas são tecnicamente bagas, mas morangos não são.',
        'O coração de um camarão fica na cabeça.',
        'Existem mais estrelas no universo do que grãos de areia em todas as praias da Terra.',
        'As impressões digitais dos coalas são quase idênticas às humanas.',
        'O Wi-Fi não significa "Wireless Fidelity", é só um nome de marketing.',
	'O nome pimbolinhas veio em uma brisa do einyx',
	'os criadores do grupo são einyx, sayori, sofia, sami, charlotte, alix e kai',
    ];
    return fatos[Math.floor(Math.random() * fatos.length)];
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

client.on('messageCreate', async (message) => {

    if (message.author.bot) return;

    try {

        // Canal onde ninguém além dos donos pode usar comandos do bot
        const CANAL_PROIBIDO_COMANDOS = '1524910258856923148';
        if (message.channel.id === CANAL_PROIBIDO_COMANDOS && message.content.startsWith('p!') && !ehDono(message)) {
            message.delete().catch(() => {});
            message.channel.send('🚫 Comandos não são permitidos nesse canal.')
                .then(aviso => setTimeout(() => aviso.delete().catch(() => {}), 5000))
                .catch(() => {});
            return;
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
                            '`p!slowmode segundos` — define o slowmode do canal\n' +
                            '`p!trancar` / `p!destrancar` — tranca/destranca o canal atual\n' +
                            '`p!lockdown` / `p!openup` — tranca/destranca TODOS os canais\n' +
                            '`p!nuke` — recria o canal do zero\n' +
                            '`p!aviso @user motivo` — avisa um membro\n' +
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
                            '`p!sessão HH:MM` — agenda as chamadas 1/3, 2/3 e 3/3 (fuso GMT-3)'
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
                            '`p!pagar (valor)` / `p!divida` — paga ou vê sua dívida'
                    },
                    {
                        name: '🎲 Apostas',
                        value:
                            '`p!blackjack (valor)` — joga blackjack (`hit`/`parar`)\n' +
                            '`p!cacaniquel (valor)` — caça-níquel (só trinca paga)\n' +
                            '`p!roleta (valor) (vermelho|preto|verde)`\n' +
                            '`p!bola (valor)` — Jogo da Bola multiplayer (lobby de 30s)\n' +
                            '`p!corrida (valor) (nº do cavalo)` — corrida multiplayer (lobby de 30s)'
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

            const totalAtual = (avisos.get(alvo.id) || 0) + 1;
            avisos.set(alvo.id, totalAtual);
            salvarDados();

            alvo.send(
                `⚠️ Você recebeu um aviso em **${message.guild.name}**.\nMotivo: ${motivo}`
            ).catch(() => {});

            return message.channel.send(
                `⚠️ **${alvo.username}** foi avisado(a). Motivo: ${motivo}\nTotal de avisos: ${totalAtual}`
            );
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
            const conta = pegarConta(message.author.id);

            if (!conta.casadoCom) {
                return message.reply('❌ Você não está casado(a) com ninguém.');
            }

            const exParceiroId = conta.casadoCom;
            const contaExParceiro = pegarConta(exParceiroId);

            conta.casadoCom = null;
            contaExParceiro.casadoCom = null;
            salvarDados();

            let nomeExParceiro = 'seu(sua) ex';
            try {
                const usuario = await client.users.fetch(exParceiroId);
                nomeExParceiro = usuario.username;
            } catch (_) {}

            const embed = new EmbedBuilder()
                .setTitle('💔 Divórcio')
                .setColor(0x99AAB5)
                .setDescription(`**${message.author.username}** e **${nomeExParceiro}** se divorciaram.`);

            return message.reply({ embeds: [embed] });
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
});

client.login(process.env.TOKEN);
