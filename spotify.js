// Módulo pra buscar faixas de playlists/álbuns do Spotify SEM precisar de
// conta de desenvolvedor nem client id/secret.
//
// Usa o pacote "spotify-url-info", que lê os dados direto da página de
// embed pública do Spotify (open.spotify.com/embed/...). Não é a API
// oficial, então: só funciona com playlists/álbuns públicos, e playlists
// muito grandes podem vir com a lista de faixas limitada (é o que a própria
// página de embed do Spotify mostra).

const { getTracks } = require('spotify-url-info')(fetch);

function ehPlaylistOuAlbum(texto) {
    return /open\.spotify\.com\/(playlist|album)\//i.test(texto);
}

// Retorna um array de { titulo, artista } a partir de uma URL de
// playlist ou álbum do Spotify.
async function buscarFaixas(url) {
    let tracks;
    try {
        tracks = await getTracks(url);
    } catch (erro) {
        console.error('Erro ao ler playlist/álbum do Spotify:', erro);
        throw new Error('Não consegui ler essa playlist/álbum do Spotify (confere se o link tá certo e se ela é pública).');
    }

    if (!tracks || tracks.length === 0) {
        throw new Error('Não encontrei músicas nessa playlist/álbum.');
    }

    return tracks
        .filter(t => t && t.name)
        .map(t => ({ titulo: t.name, artista: t.artist || '' }));
}

module.exports = { buscarFaixas, ehPlaylistOuAlbum };
