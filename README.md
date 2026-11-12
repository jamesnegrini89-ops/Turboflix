# TurboFlix — IPTV Player PWA (M3U + Xtream Codes)

Aplicativo web progressivo (**PWA**) inspirado no visual espacial roxo do **TurboFlix**, pronto para hospedar gratuitamente no **GitHub Pages** e usar no **Amazon Fire TV Stick**, **Android TV**, **celular (Android / iPhone)** e **computador**.

---

## Recursos incluídos

- **Visual idêntico ao modelo**: fundo espacial roxo com nebulosa, barra superior (`Início`, `Minha Lista`, `Buscar`, `Configurações` + relógio), cards verticais de categorias com **TV AO VIVO** em destaque no centro, fileira **Destaques para Você** (Globoplay, Netflix, Prime Video, Disney+, HBO Max, Apple TV+, Paramount+, Crunchyroll) e fileira **Jogos de Hoje** (eventos e canais de esportes).
- **2 modos de acesso**:
  1. **Link M3U / M3U8 simples** (`http://` ou `https://`) — inclusive reconhece links `get.php?username=...&password=...` automaticamente.
  2. **Login Xtream Codes** (Servidor + Usuário + Senha) via `player_api.php`.
- **Player completo integrado**:
  - Canais ao vivo em **HLS (`.m3u8`)** via `hls.js` e **MPEG-TS (`.ts`)** via `mpegts.js`, além de vídeos **MP4/MKV/WebM** nativos.
  - Troca rápida de canal com **▲ / ▼** no controle remoto.
  - Avanço/retrocesso de 10s, tela cheia e avanço automático para o próximo episódio.
- **Tela flutuante (Picture-in-Picture)**: botão próprio durante a reprodução, controles Play/Pause integrados ao Android/navegador via Media Session e tentativa automática ao minimizar quando o ambiente permite. O sistema operacional controla posicionamento e redimensionamento (incluindo gesto de pinça nos dispositivos compatíveis).
- **Continuar Assistindo**: salva exatamente o segundo onde você parou em filmes e episódios (e os últimos canais abertos).
- **Minha Lista (Favoritos)**: adicione ou remova canais, filmes e séries segurando o botão **OK** no controle (ou toque longo no celular).
- **Busca instantânea**: pesquisa sem diferenciar maiúsculas ou acentos em milhares de canais, filmes e séries.
- **Navegação 100% compatível com Controle Remoto (Fire TV / TV Box)** e **Toque (Celular)**.
- **Instalável (PWA)**: possui `manifest.webmanifest`, ícones e `sw.js` (Service Worker).

---

## Estrutura de pastas

```text
turboflix/
├── index.html                 # Página principal do aplicativo
├── manifest.webmanifest       # Manifesto PWA (instalação na tela inicial)
├── sw.js                      # Service Worker (cache offline do app)
├── .nojekyll                  # Evita processamento Jekyll no GitHub Pages
├── css/
│   └── style.css              # Estilo espacial roxo responsivo (TV + Celular)
├── js/
│   ├── app.js                 # Telas, rotas, categorias e eventos
│   ├── m3u.js                 # Parser de listas #EXTM3U / #EXTINF
│   ├── xtream.js              # Cliente da API Xtream Codes
│   ├── player.js              # Player HLS (.m3u8) + MPEG-TS (.ts) + MP4
│   ├── nav.js                 # Navegação espacial por setas (controle Fire TV)
│   ├── net.js                 # Rede + suporte a Proxy HTTP/CORS
│   ├── storage.js             # Favoritos, Continuar Assistindo e IndexedDB
│   ├── icons.js               # Ícones vetoriais SVG
│   └── vendor/
│       ├── hls.min.js         # Biblioteca HLS.js local
│       └── mpegts.js          # Biblioteca mpegts.js local
├── icons/
│   ├── icon.svg               # Ícone vetorial
│   ├── icon-192.png           # Ícone PWA 192x192
│   ├── icon-512.png           # Ícone PWA 512x512
│   └── icon-maskable-512.png  # Ícone adaptável Android
└── proxy/
    └── cloudflare-worker.js   # Proxy opcional gratuito (para links http://)
```

---

## Como publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `turboflix`).
2. Envie todos os arquivos desta pasta para a raiz do repositório.
3. No GitHub, abra **Settings → Pages**.
4. Em **Build and deployment**, selecione **Deploy from a branch**, escolha a branch `main` e a pasta `/ (root)`, depois clique em **Save**.
5. Aguarde ~1 minuto e acesse `https://SEU-USUARIO.github.io/turboflix/`.

---

## Importante sobre links `http://` no GitHub Pages

O GitHub Pages utiliza **`https://`**. Por regra de segurança de todos os navegadores, uma página `https://` **bloqueia conexões diretas a servidores `http://`** (*Mixed Content*), e muitos servidores IPTV também bloqueiam acesso direto do navegador (*CORS*).

Para usar listas e canais `http://` sem qualquer bloqueio:

1. Crie uma conta gratuita em [dash.cloudflare.com](https://dash.cloudflare.com).
2. Vá em **Workers & Pages → Create → Create Worker**, escolha um nome e clique em **Deploy**.
3. Clique em **Edit code**, cole o conteúdo do arquivo [`proxy/cloudflare-worker.js`](proxy/cloudflare-worker.js) e clique em **Deploy**.
4. Copie o endereço gerado (ex.: `https://turboflix-proxy.seu-usuario.workers.dev`) e cole no campo **Proxy** na tela de Login ou em **Configurações** do TurboFlix.

---

## Como usar no Celular e no Fire TV

- **No Celular (Android / Chrome)**: abra o link do seu GitHub Pages, toque no menu `⋮` do navegador e selecione **Adicionar à tela inicial / Instalar aplicativo**.
- **No iPhone / iPad (Safari)**: abra o link, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.
- **No Amazon Fire TV Stick**: abra o navegador **Amazon Silk** (ou crie um atalho com *Web App Tester* / *Bookmarker*), acesse o link do seu GitHub Pages e navegue normalmente com as setas e o botão **OK** do controle remoto.

---

## Tela flutuante no Android (versão web 1.8.7)

Durante a reprodução, toque no ícone **Tela flutuante** no canto superior do player. Se o navegador permitir Picture-in-Picture, o vídeo continuará numa janela sobre outros aplicativos, com controles nativos de reprodução. O Android gerencia o tamanho e os gestos de pinça, quando compatíveis.

O TurboFlix também registra ações de Media Session para permitir que navegadores compatíveis solicitem PiP automaticamente ao trocar de aba ou minimizar, mas **não há garantia de ativação automática**. A API web normalmente exige interação do usuário. Verifique as permissões de Picture-in-Picture para o navegador no Android.

**Atenção:** os arquivos APK deste repositório não são recompilados por esta alteração. Um aplicativo Android nativo com WebView pode exigir suporte a PiP na Activity/AndroidManifest (incluindo `supportsPictureInPicture` e `setAutoEnterEnabled`) para entrar automaticamente na janela flutuante ao pressionar Home. Sem o projeto-fonte Android e uma nova compilação do APK, este recurso automático não pode ser garantido nesses pacotes.


## Compatibilidade Chrome 1.8.7

As versões de importação dos módulos JavaScript foram unificadas, evitando caches de rede e DNS independentes entre os componentes do app. O Picture-in-Picture é carregado separadamente e não deve impedir a inicialização do player principal. Se a política do Chrome recusar a reprodução automática, o aplicativo oferece o botão **Toque para reproduzir** para tentar novamente a partir de um gesto explícito.

**Importante:** quando um servidor IPTV utiliza HTTP e o aplicativo roda em HTTPS (GitHub Pages), o Chrome pode bloquear conteúdo misto ou CORS. Um proxy HTTPS compatível continua necessário nesses casos. Os dados de acesso IPTV não foram alterados.
