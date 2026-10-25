# Verificação de regressões

Requisitos: Node.js, Playwright disponível para `require('playwright')`, Chromium e FFmpeg (somente teste do player). Não é necessário instalar dependências para executar o app. Para testes, Playwright pode ser instalado em uma pasta externa ao checkout, usando `NODE_PATH` para apontar para seu `node_modules`.

Na raiz do projeto, mantenha o servidor em um terminal:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory app/src/main/assets/www
```

Em outro terminal:

```sh
node tests/browser.cjs
node tests/player.cjs
```

`TEST_BASE_URL` altera a origem local; `CHROMIUM_PATH` altera o executável (padrão `/usr/bin/chromium`). Os testes não precisam de conta IPTV: simulam um catálogo de 50 mil itens e geram um vídeo temporário, removido após o teste.

Cobertura: importação Xtream, grade incremental, setas de controle remoto, busca sem acentos e foco após Enter, resposta atrasada de séries, preferência HLS, viewport de 360px, PWA offline, cache restrito à interface, reprodução MP4, troca rápida e fechamento do player. O teste imprime tempo e leituras de layout da navegação; o tempo depende da máquina. Não substitui testes em Fire TV física, Safari/iOS ou reprodução de todos os formatos/codecs do provedor. Os testes de navegador não compilam Java: use também `./gradlew :app:assembleDebug :app:lintDebug`. A ponte DLNA simulada verifica o despacho assíncrono e a pausa/retomada do vídeo, sem simular uma TV física.
