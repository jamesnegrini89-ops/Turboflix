# TurboFlix Android com Picture-in-Picture (versão 1.8.7)

Este é um novo aplicativo Android (WebView) que abre o TurboFlix 1.8.7 publicado no GitHub Pages e oferece **Picture-in-Picture nativo** do Android. A lista M3U/Xtream e o Cloudflare Worker são configurados pelo próprio usuário no aplicativo, sem credenciais no código-fonte.

## Compilação

Execute o workflow **Compilar TurboFlix Android com PiP** em GitHub Actions ou utilize `gradle -p android assembleDebug` com Java 17 e Android SDK 35. O APK gerado tem o nome `TurboFlix-Android-PiP-1.8.7.apk`. Este projeto publica a saída debug assinada por uma chave gerada no runner. É uma versão de teste, não uma compilação release da Play Store.

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
