# TurboFlix Android com Picture-in-Picture (versão 1.8.8)

Este é um aplicativo Android (WebView) que abre o TurboFlix web e oferece **Picture-in-Picture nativo**, além de **tela cheia com rotação horizontal acionada pelo botão**, independentemente da rotação automática do celular. A lista M3U/Xtream e o Cloudflare Worker são configurados pelo próprio usuário no aplicativo, sem credenciais no código-fonte.

## Compilação

Execute o workflow **Compilar TurboFlix Android com PiP** em GitHub Actions ou utilize `gradle -p android assembleDebug` com Java 17 e Android SDK 35. O APK gerado tem o nome `TurboFlix-Android-PiP-1.8.8.apk`. Este projeto publica a saída debug assinada por uma chave gerada no runner. É uma versão de teste, não uma compilação release da Play Store.

## Uso

1. Instale o novo APK no celular Android 8.0 ou posterior.
2. Configure sua lista e o endereço do Worker HTTPS novamente, se necessário. O armazenamento do APK é separado do armazenamento do Chrome.
3. Inicie um filme ou canal. O player apresenta um botão **▣** para entrar no PiP.
4. Com vídeo em reprodução, pressione Home ou minimize para permitir a transição automática. Android 12+ usa `setAutoEnterEnabled`; Android 8 a 11 usa `onUserLeaveHint`.
5. Use os controles Play/Pause da janela PiP. Redimensionamento e gesto de pinça dependem do Android e do aparelho.

## Limitações

- Este não é o projeto-fonte original dos APKs 1.8.5, que não está disponível neste repositório.
- O identificador de pacote é **com.turboflix.pip**, diferente do app anterior. Pode ser instalado lado a lado. Não substitui o APK original nem preserva automaticamente seu armazenamento.
- A assinatura debug gerada nos runners é temporária; builds futuros exigirão desinstalação ou assinatura permanente configurada.
- A reprodução depende dos formatos suportados pelo WebView do Android, do serviço IPTV e do proxy HTTPS. Não foi testada fisicamente em um aparelho.
- O app não contém conteúdo e não distribui listas IPTV.
- Caso sejam necessários recursos nativos do APK anterior, como integrações DLNA específicas, eles precisam ser migrados do código-fonte Android original.


## Correção da tela cheia (APK 1.8.8)

No player, toque em **Tela cheia** no canto inferior direito. A Activity Android
oculta as barras de sistema, gira o vídeo para paisagem e amplia a área útil mesmo
com a rotação automática desativada. Toque novamente no ícone ou use Voltar para
retornar à orientação anterior. Minimizar com o conteúdo em reprodução mantém
a funcionalidade PiP, quando disponível.

Esta correção exige **instalar o novo APK 1.8.8** para obter o controle nativo
de orientação. A interface web 1.11.1 também melhora o botão no navegador,
mas não consegue instalar o novo método Java no APK 1.8.7.

A assinatura debug é gerada separadamente em cada compilação GitHub Actions.
Se a instalação por cima do APK 1.8.7 falhar por assinatura incompatível,
será necessário desinstalar a versão anterior (isso apaga as preferências e
listas salvas dentro daquele APK) e instalar a 1.8.8. Salve os dados da
lista e do Worker em um local seguro antes de desinstalar.

O Build Android do branch de testes compila e disponibiliza um artefato sem
publicar no main. A versão final só é publicada após os testes.
