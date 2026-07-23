<table>
<tr>
<td width="150">
<img src="assets/sr pimbolinhas.webp" width="130" alt="Sr. Pimbolinhas" />
</td>
<td>

# 🤖 Sr. Pimbolinhas

Bot multifuncional pra Discord — economia, moderação, jogos, música, sessões de RP, painéis do servidor e muito mais, tudo debaixo do prefixo `p!`.

</td>
</tr>
</table>

---

## 📖 Sobre

Sr. Pimbolinhas é um bot "faz tudo" pensado pra servidores de RP/comunidade: além dos comandos clássicos de moderação e diversão, ele tem um sistema de economia completo, cassino, música, painéis de estatísticas e um sistema próprio de **chamadas de sessão** com controle de presença/falta.

Todos os dados (economia, avisos, sessões, murais, etc.) são salvos em disco (`dados.json`), então nada se perde se o bot reiniciar.

## ⚙️ Instalação

```bash
git clone <url-do-seu-repositório>
cd <pasta-do-projeto>
npm install
```

Crie um arquivo `.env` na raiz do projeto com o token do bot:

```env
TOKEN=seu_token_do_discord_aqui
```

E rode:

```bash
node index.js
```

> Pra tocar música é necessário ter o `ffmpeg` disponível no sistema, além das dependências de áudio já listadas no `package.json` (`discord.js`, `@discordjs/voice`, `dotenv`, etc).

## 🧭 Comandos

Todos os comandos usam o prefixo `p!`. Use `p!ajuda` no servidor pra ver a lista completa a qualquer momento.

### 🎉 Diversão
| Comando | Descrição |
|---|---|
| `p!escolher opção1 \| opção2` | Sorteia entre as opções |
| `p!dado` / `p!dado 20` | Rola um dado (padrão d6) |
| `p!moeda` | Cara ou coroa |
| `p!8ball pergunta` | Bola 8 mágica |
| `p!ship @user1 @user2` | Compatibilidade entre dois membros |
| `p!gay [@user]` | Porcentagem aleatória (só brincadeira) |
| `p!fato` | Fato curioso aleatório |
| `p!dica` | Dica de uso do Discord |
| `p!gato` | Foto aleatória de gato |
| `p!perguntar pergunta` | Pergunta pro Sr. Pimbolinhas |

### 🛡️ Moderação
| Comando | Descrição |
|---|---|
| `p!limpar quantidade` | Apaga mensagens |
| `p!slowmode segundos` | Define o slowmode do canal |
| `p!trancar` / `p!destrancar` | Tranca/destranca o canal atual |
| `p!lockdown` / `p!openup` | Tranca/destranca TODOS os canais |
| `p!nuke` | Recria o canal do zero |
| `p!aviso @user motivo` | Avisa um membro |
| `p!userinfo [@user]` | Informações de um membro |
| `p!serverinfo` | Informações do servidor |

Além dos comandos, o bot modera automaticamente:
- 🚫 **Contas com menos de 7 dias de criação são removidas do servidor** assim que entram (com aviso por DM).
- 🔒 Comandos bloqueados pra quem não é dono em canais específicos.

### 📢 Anúncios e utilidade
| Comando | Descrição |
|---|---|
| `p!embed #canal \| Título \| Descrição` | Cria um embed |
| `p!enquete pergunta \| opção1 \| opção2` | Votação simples |
| `p!votacao pergunta \| opções` | Votação completa (`p!votacao fechar` pra apurar) |
| `p!sugestao ideia` | Envia uma sugestão |
| `p!sorteio duração \| prêmio \| vencedores` | Ex: `60s`, `10m`, `2h` |
| `p!contadorregressivo duração \| evento` | Ex: `2h \| Sessão` |
| `p!capsula AAAA-MM-DD \| mensagem` | Revela uma mensagem numa data futura |
| `p!sessão HH:MM` | Agenda as chamadas 1/3, 2/3 e 3/3 de uma sessão (fuso GMT-3), com controle automático de presença/falta |

### 📊 Painéis
| Comando | Descrição |
|---|---|
| `p!mural` / `p!mural add texto` / `p!mural remover nº` | Mural de recados |
| `p!changelog` / `p!changelog add texto` | Changelog do servidor |
| `p!estatisticas` | Painel completo do servidor |
| `p!snapshot salvar` / `p!snapshot comparar` | Compara o servidor entre dois momentos |

### 🎵 Música
| Comando | Descrição |
|---|---|
| `p!tocar nome/link` | Toca ou adiciona na fila (YouTube ou Spotify) |
| `p!fila` | Mostra a fila atual |
| `p!pular` | Pula pra próxima música |
| `p!pausar` / `p!continuar` | Pausa/retoma |
| `p!parar` | Para tudo e sai do canal de voz |
| `p!loop` | Ativa/desativa repetição da música atual |

### 💰 Economia
| Comando | Descrição |
|---|---|
| `p!perfil [@user]` | Mostra nível e saldo |
| `p!leaderboard [página]` | Ranking dos mais ricos |
| `p!casar @user` / `p!divorciar` | Casamento entre membros |
| `p!depositar (valor)` / `p!sacar (valor)` | Banco (aceita `tudo`) |
| `p!pagarp (valor)` | Paga imposto voluntariamente (vai direto pro fundo) |
| `p!transferir @user (valor)` | Manda Miracoins pra alguém |
| `p!cobrar @user (valor)` | Cobra alguém (precisa aceitar) |
| `p!diario` | Recompensa diária (dobra a cada 5 dias de sequência) |
| `p!emprestimo (valor)` | Empréstimo do imposto arrecadado |
| `p!pagar (valor)` / `p!divida` | Paga ou vê sua dívida |

### 🎰 Cassino
| Comando | Descrição |
|---|---|
| `p!blackjack (valor)` | Blackjack (`hit`/`parar`) |
| `p!cacaniquel (valor)` | Caça-níquel |
| `p!roleta (valor) (vermelho\|preto\|verde)` | Roleta |
| `p!bola (valor)` | Jogo da Bola multiplayer (lobby de 30s) |
| `p!corrida (valor) (nº do cavalo)` | Corrida multiplayer (lobby de 30s) |

### 👑 Administração
| Comando | Descrição |
|---|---|
| `p!addmoney @user (valor)` / `p!removemoney @user (valor)` | Adiciona/remove Miracoins |
| `p!addmoneytodos (valor)` | Dá Miracoins pra todo mundo |
| `p!aluguel (valor) @user` / `p!cobrarimposto (valor) @user` | Cobranças administrativas |
| `p!impostogeral (valor)` | Cobra todo mundo de uma vez |
| `p!imposto` / `p!pegarimposto [valor]` | Ver e sacar o fundo do imposto |
| `p!addlevel @user (qtd)` / `p!removelevel @user (qtd)` | Ajusta nível de um membro |

### 🖼️ Outros
| Comando | Descrição |
|---|---|
| `p!avatar [@user]` | Mostra o avatar |
| `p!contador` | Total de membros, humanos e bots |

## 💾 Persistência de dados

Tudo fica salvo em `dados.json`: economia, avisos, sessões agendadas, murais, changelogs, snapshots, votações e capsulas do tempo pendentes. Não delete esse arquivo se não quiser perder o progresso do servidor.

## 🛠️ Tecnologias

- [discord.js](https://discord.js.org/)
- [@discordjs/voice](https://github.com/discordjs/voice) (música)
- Node.js + `dotenv`

---

<p align="center">Feito com 🐈 e café, pelo e pro servidor.</p>
