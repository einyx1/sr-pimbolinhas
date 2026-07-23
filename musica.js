const { spawn } = require('child_process');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const prism = require('prism-media');

// Roda o yt-dlp em modo --dump-json e devolve o resultado já parseado.
// Usado só pra pegar metadados (título/duração/url), não pra baixar áudio.
function ytdlpJson(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let saida = '';
        let erro = '';

        proc.stdout.on('data', (d) => { saida += d; });
        proc.stderr.on('data', (d) => { erro += d; });

        proc.on('error', (err) => reject(err));

        proc.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(erro.trim() || `yt-dlp saiu com código ${code}`));
            }
            try {
                // Com --no-playlist só vem uma linha de JSON, mas por segurança
                // pegamos só a primeira caso venha mais de uma.
                const primeiraLinha = saida.trim().split('\n')[0];
                resolve(JSON.parse(primeiraLinha));
            } catch (e) {
                reject(new Error('Não consegui interpretar a resposta do yt-dlp.'));
            }
        });
    });
}

/**
 * Busca informações de uma música por URL do YouTube ou termo de busca.
 * @param {string} query - URL do YouTube ou termo de busca
 * @returns {Promise<{url: string, titulo: string, duracao: number}>}
 */
async function buscarInfoMusica(query) {
    const alvo = query.startsWith('http') ? query : `ytsearch1:${query}`;

    const info = await ytdlpJson([
        alvo,
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        '-f', 'bestaudio',
    ]);

    return {
        url: info.webpage_url || info.original_url || alvo,
        titulo: info.title,
        duracao: Math.floor(info.duration || 0)
    };
}

/**
 * Cria um AudioResource pronto pra tocar, a partir de uma URL do YouTube,
 * extraindo o áudio com yt-dlp e convertendo com ffmpeg (via prism-media).
 * @param {string} url - URL do YouTube (já resolvida)
 * @returns {import('@discordjs/voice').AudioResource}
 */
function criarRecursoAudio(url) {
    const ytdlp = spawn('yt-dlp', [
        url,
        '-f', 'bestaudio',
        '-o', '-',
        '--quiet',
        '--no-warnings',
        '--no-playlist',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ytdlp.stderr.on('data', (data) => {
        console.error(`[yt-dlp] ${data.toString().trim()}`);
    });

    ytdlp.on('error', (err) => {
        console.error('Erro ao iniciar o yt-dlp (verifica se está instalado):', err);
    });

    ytdlp.on('close', (code) => {
        if (code !== 0) console.error(`yt-dlp encerrou com código ${code}`);
    });

    const ffmpeg = new prism.FFmpeg({
        args: [
            '-analyzeduration', '0',
            '-loglevel', '0',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
        ],
    });

    ffmpeg.on('error', (err) => {
        console.error('Erro no ffmpeg:', err);
    });

    const stream = ytdlp.stdout.pipe(ffmpeg);

    return createAudioResource(stream, { inputType: StreamType.Raw });
}

module.exports = { buscarInfoMusica, criarRecursoAudio };
