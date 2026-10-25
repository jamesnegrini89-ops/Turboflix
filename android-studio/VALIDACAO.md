# Validação desta entrega

## Compilação Android

Executado na máquina de desenvolvimento com JDK Temurin 17, Gradle Wrapper 8.13, Android Gradle Plugin 8.13.2, SDK 35 e Build-Tools 35.0.0:

```sh
./gradlew :app:assembleDebug :app:lintDebug
```

Resultado: **BUILD SUCCESSFUL**. O APK de depuração foi gerado. A análise Lint não encontrou erros. Permanecem avisos de atualização de ferramentas/target SDK, atributos ignorados em versões antigas, formato do ícone original e configuração de rede (HTTP e certificados de usuário, herdados do projeto para compatibilidade). Não foram desativadas verificações para obter esse resultado.

A máquina de compilação emitia avisos sobre telemetria em uma pasta sem escrita e Platform-Tools ausente; eles não impediram a geração do APK nem a execução do Lint. O SDK Manager do Android Studio deve instalar os componentes e solicitar as licenças na máquina do usuário.

## Interface e player

Testes contra `app/src/main/assets/www`, usando Chromium e Playwright:

- Importação de catálogo simulado com 50.000 itens.
- Carregamento incremental e navegação com setas.
- Busca sem acentos e foco preservado após Enter.
- Resposta tardia de série sem modificar uma tela nova.
- Preferência HLS respeitada mesmo com entrada originalmente TS.
- Layout de 360 pixels e navegação horizontal de categorias no celular.
- Cache offline restrito à interface quando executado como página HTTP.
- Reprodução de MP4 gerado localmente, trocas rápidas e liberação da mídia ao fechar.
- Ponte nativa simulada: chamadas assíncronas permitem que a interface continue executando.
- Pausa em segundo plano, retomada e preservação da pausa manual.
- A abertura direta por `file:` foi tentada, mas o Chromium da nuvem recusou com `ERR_BLOCKED_BY_ADMINISTRATOR`; essa verificação não passou a executar e permanece para o WebView no aparelho. Os testes da interface acima foram feitos por HTTP local.

A sintaxe dos módulos JavaScript foi verificada com Node.js. Os testes não usam dados reais de IPTV.

## Limites

Não foi executado em emulador Android, aparelho Fire TV, celular físico ou receptor DLNA. A compilação valida o código Java e os recursos Android; o comportamento de rede local, codecs, áudio e integração com o WebView do aparelho precisa ser confirmado em hardware real. A reprodução real da lista testada anteriormente no site não substitui esta validação do APK.
