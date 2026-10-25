# TurboFlix Android / Fire TV — 1.8.5

Projeto Android Studio completo. A interface web está em `app/src/main/assets/www`; a integração Android está em `app/src/main/java/com/turboflix/tv/MainActivity.java`.

## Abrir e compilar

1. Extraia o ZIP e abra a pasta que contém `settings.gradle.kts` no Android Studio.
2. Use uma versão do Android Studio compatível com Android Gradle Plugin 8.13.2. Nas configurações de Gradle, selecione um **JDK completo 17 ou superior** (o JDK integrado do Android Studio é a opção usual).
3. No SDK Manager, instale **Android SDK Platform 35** e **Build-Tools 35.0.0**. Aceite as licenças solicitadas pelo Android Studio.
4. Aguarde a sincronização. O Gradle Wrapper baixa o Gradle 8.13 com verificação SHA-256.
5. Selecione `app` e use **Build → Build App Bundle(s) / APK(s) → Build APK(s)**, ou execute:

```sh
./gradlew :app:assembleDebug :app:lintDebug
```

No Windows:

```bat
gradlew.bat :app:assembleDebug :app:lintDebug
```

O APK de teste fica em `app/build/outputs/apk/debug/app-debug.apk`.

O ZIP não inclui caches, SDK, dependências baixadas, `local.properties`, configurações particulares do Android Studio ou dados IPTV. O Android Studio recria os arquivos locais. Informe sua lista na tela de login do app.

## Melhorias incluídas

- Navegação da grade com menos leituras de layout, catálogo incremental e cache dos itens recentes.
- Busca com foco estável após Enter; proteção contra respostas atrasadas de séries.
- Player com descarte de tentativas antigas, troca rápida e preferência HLS/TS respeitada.
- Ajustes de layout em telas estreitas, áreas seguras e movimento reduzido.
- DLNA nativo assíncrono: a busca e o controle da TV não bloqueiam a thread JavaScript. Há limites de fila, tempo e tamanho das descrições.
- Multicast Wi-Fi ativado somente durante a descoberta e liberado ao terminar.
- Pausa ao colocar o app em segundo plano; retomada somente se o vídeo estava reproduzindo. Pausa manual é preservada.
- Tela mantida ligada durante reprodução, sem manter o aparelho acordado permanentemente nas telas de catálogo.
- User-Agent real do WebView preservado. Páginas externas abrem no navegador, fora da ponte nativa.
- Recursos locais carregados sem depender de Service Worker no protocolo `file:`.
- `versionCode` aumentado para 2 e versão exibida alinhada com 1.8.5.

## Instalação e compatibilidade

O identificador continua `com.turboflix.tv`. Para atualizar uma instalação existente sem perder dados, assine com a **mesma chave** da versão anterior. Uma chave de depuração gerada em outro computador pode ser diferente. Para distribuição, use **Generate Signed Bundle / APK** com sua própria chave e guarde-a.

O projeto mantém `minSdk 22`, suporte a controle remoto e touchscreen opcional. Isso não garante funcionamento de todos os codecs em toda geração de Fire TV: o motor WebView precisa suportar os módulos JavaScript usados pelo app, e codecs dependem do dispositivo. Atualize o WebView/Fire OS quando disponível.

O app permite HTTP para os servidores IPTV que precisam dele e mantém a validação TLS. Não foi adicionado provedor, lista ou senha ao código. Cópia automática dos dados do app foi desativada para evitar levar configurações IPTV para backups do sistema.

## Testes

Veja `tests/README.md` e `VALIDACAO.md`. Os testes web usam dados simulados e um vídeo gerado localmente; a ponte nativa é simulada nos testes de navegador. Reprodução, controle remoto, teclado virtual e DLNA devem ser conferidos também no aparelho físico. Não há emulador ou TV DLNA nesta máquina.
