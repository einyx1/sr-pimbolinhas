<table>
<tr>
<td width="150">
<img src="assets/sr pimbolinhas.webp" width="130" alt="Sr. Pimbolinhas" />
</td>
<td>

# Sr. Pimbolinhas

bot do discord que faz de tudo. economia, moderação, música, RP, cassino, painéis — prefixo `p!`.

</td>
</tr>
</table>

---

## sobre

nasceu pra servidores de RP e comunidade. tem sistema de economia completo, cassino, música, controle de sessão com presença/falta, painéis de server e moderação automática.

tudo salvo em `dados.json` — reiniciou o bot, os dados continuam lá.

---

## instalação

```bash
git clone https://github.com/einyx1/sr-pimbolinhas
cd sr-pimbolinhas
npm install
```

cria um `.env` na raiz:

```env
TOKEN=seu_token_aqui
```

roda:

```bash
node index.js
```

> música precisa do `ffmpeg` instalado no sistema.

---

## comandos

use `p!ajuda` no servidor pra ver tudo. aqui vai um resumo:

### diversão
| comando | o que faz |
|---|---|
| `p!escolher a \| b` | sorteia entre opções |
| `p!dado` / `p!dado 20` | rola dado (padrão d6) |
| `p!moeda` | cara ou coroa |
| `p!8ball pergunta` | bola 8 |
| `p!ship @a @b` | compatibilidade |
| `p!gay [@user]` | % aleatória, só zueira |
| `p!fato` | fato curioso |
| `p!gato` | foto de gato |
| `p!perguntar pergunta` | pergunta pro bot |

### moderação
| comando | o que faz |
|---|---|
| `p!limpar N` | apaga mensagens |
| `p!slowmode N` | define slowmode |
| `p!trancar` / `p!destrancar` | tranca o canal |
| `p!lockdown` / `p!openup` | tranca/abre tudo |
| `p!nuke` | recria o canal |
| `p!aviso @user motivo` | avisa alguém |
| `p!userinfo [@user]` | info do membro |
| `p!serverinfo` | info do servidor |

contas com menos de 7 dias são kickadas automaticamente na entrada, com DM de aviso.

### anúncios e utilidade
| comando | o que faz |
|---|---|
| `p!embed #canal \| Título \| Desc` | cria embed |
| `p!enquete pergunta \| op1 \| op2` | votação simples |
| `p!votacao pergunta \| opções` | votação completa |
| `p!sorteio duração \| prêmio \| N` | ex: `10m \| nitro \| 1` |
| `p!sessão HH:MM` | agenda chamadas 1/3, 2/3, 3/3 com controle de presença (GMT-3) |
| `p!capsula AAAA-MM-DD \| msg` | mensagem que aparece numa data futura |

### painéis
| comando | o que faz |
|---|---|
| `p!mural` / `p!mural add` / `p!mural remover N` | mural de recados |
| `p!changelog` / `p!changelog add` | changelog do servidor |
| `p!estatisticas` | painel geral |
| `p!snapshot salvar` / `p!snapshot comparar` | compara o server entre dois momentos |

### música
| comando | o que faz |
|---|---|
| `p!tocar nome/link` | toca ou enfileira (YouTube ou Spotify) |
| `p!fila` | fila atual |
| `p!pular` | próxima |
| `p!pausar` / `p!continuar` | pausa/retoma |
| `p!parar` | para e sai |
| `p!loop` | repete a música atual |

### economia
| comando | o que faz |
|---|---|
| `p!perfil [@user]` | nível e saldo |
| `p!leaderboard` | ranking dos mais ricos |
| `p!diario` | recompensa diária (dobra a cada 5 dias seguidos) |
| `p!depositar` / `p!sacar` | banco (aceita `tudo`) |
| `p!transferir @user valor` | manda Miracoins |
| `p!cobrar @user valor` | cobra alguém (precisa aceitar) |
| `p!emprestimo valor` | pega empréstimo do fundo |
| `p!casar @user` / `p!divorciar` | casamento entre membros |

### cassino
| comando | o que faz |
|---|---|
| `p!blackjack valor` | blackjack (`hit` / `parar`) |
| `p!cacaniquel valor` | caça-níquel |
| `p!roleta valor cor` | vermelho / preto / verde |
| `p!bola valor` | multiplayer, lobby de 30s |
| `p!corrida valor N` | corrida de cavalos, lobby de 30s |

### admin
| comando | o que faz |
|---|---|
| `p!addmoney @user valor` / `p!removemoney` | edita saldo |
| `p!addmoneytodos valor` | dá Miracoins pra todo mundo |
| `p!impostogeral valor` | cobra todo mundo |
| `p!addlevel @user N` / `p!removelevel` | ajusta nível |

---

## dados

tudo fica em `dados.json` — economia, avisos, sessões, murais, changelogs, snapshots, votações, cápsulas. não deleta esse arquivo.

---

## stack

- [discord.js](https://discord.js.org/)
- [@discordjs/voice](https://github.com/discordjs/voice)
- node.js + dotenv

---

<p align="center">feito com 🐈 e café</p>
