# Profiles

[English](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Français](README.fr.md) · [Italiano](README.it.md) · **Português** · [Русский](README.ru.md) · [日本語](README.ja.md) · [简体中文](README.zh_CN.md)

Um plugin para o [DankMaterialShell](https://github.com/AvengeMedia/DankMaterialShell) que salva a aparência do seu shell com um nome e permite alternar entre essas aparências. Um perfil guarda o tema e a cor de destaque, o modo claro ou escuro, o papel de parede, suas barras, a moldura, a transparência, as fontes, as animações e os widgets da área de trabalho com suas posições.

![Profiles](assets/screenshot.png)

Passo a passo com imagens: [guia de instalação e configuração](docs/GUIDE.pt.md).

## Troca de perfil

Abra o seletor com um atalho de teclado e escolha um perfil. Durante a troca, a tela fica congelada por cerca de um segundo, o perfil é aplicado por baixo e a imagem antiga sai com uma animação. Barras, cores e papel de parede mudam de uma vez, e não um depois do outro.

Há 29 transições para escolher, entre elas esmaecer, cortina, círculo, portas, persianas, derreter, estilhaços, um CRT desligando, chuvisco e cinco efeitos de hack. A opção Aleatória pode ser limitada às que você preferir. Na maioria das animações, a borda brilha na cor de destaque do novo perfil.

## Seletor

O seletor tem quatro visualizações: uma fileira sobre um painel, a mesma fileira sem o painel, um carrossel com o perfil atual grande no meio e uma grade que ocupa a tela toda. As prévias podem ser em retrato, paisagem, quadrado, círculo, hexágono ou losango. Na grade, hexágonos e losangos ficam dispostos como um favo de mel, com o mesmo espaçamento das suas janelas. Contorno, brilho, marca de seleção e arredondamento dos cantos podem ser desligados ou ajustados.

A roda do mouse e as setas movem a seleção, Enter ou um clique aplica, Esc fecha o seletor.

## Salvamento

As alterações que você faz nas configurações do DMS são salvas no perfil ativo depois de alguns segundos. Cada perfil lembra como estava quando foi ativado, então dá para desfazer as alterações na página de configurações. O papel de parede é copiado para dentro do perfil, então mover ou apagar o arquivo original não estraga nada.

Os perfis ficam em `~/.config/DankMaterialShell/profiles/`, uma pasta por perfil.

## Configurações de outros plugins

As configurações de plugins também podem fazer parte de um perfil. Informe os IDs dos plugins em Configurações → Plugins → Profiles → Plugins salvos com o perfil, por exemplo `audioFx`.

## Coisas fora do DMS

Cores do terminal, temas do navegador ou regras do compositor que o DMS não gerencia podem ser tratados com dois comandos opcionais:

- O comando ao salvar roda quando um perfil é salvo. O JSON que ele imprimir fica guardado no perfil como `extras`.
- O comando ao aplicar roda durante a troca, assim que o DMS carrega as novas configurações. A tela é revelada quando ele termina. Ele recebe `DMS_PROFILE_DIR`, `DMS_PROFILE_SLUG`, `DMS_PROFILE_NAME` e `DMS_PROFILE_NEW_COLORS` (1 se novas cores estiverem sendo geradas). O arquivo do perfil é `$DMS_PROFILE_DIR/profile.json`.

Um pequeno exemplo que guarda a fonte da interface GTK por perfil:

```sh
# save command
printf '{"font": "%s"}' "$(gsettings get org.gnome.desktop.interface font-name | tr -d "'")"

# apply command
gsettings set org.gnome.desktop.interface font-name \
  "$(python3 -c 'import json,os; print(json.load(open(os.environ["DMS_PROFILE_DIR"] + "/profile.json"))["extras"]["font"])')"
```

## Requisitos

DankMaterialShell 1.6.1 ou mais recente. A transição usa `dms screenshot`, que já vem com o DMS. Eu uso o plugin no niri. Espaçamento entre janelas, arredondamento dos cantos e largura da borda são gravados pelo próprio DMS na configuração do compositor, então devem acompanhar o perfil também em outros compositores suportados pelo DMS.

## Instalação

```sh
git clone https://github.com/21Rebel/dms-profiles ~/.config/DankMaterialShell/plugins/DmsProfiles
dms ipc call plugins enable dmsProfiles
```

Depois adicione um atalho de teclado, por exemplo no niri:

```kdl
Mod+Shift+M { spawn "dms" "ipc" "call" "profiles" "toggle"; }
```

## IPC

```sh
dms ipc call profiles toggle
dms ipc call profiles list
dms ipc call profiles apply <slug>
dms ipc call profiles create <name>
dms ipc call profiles save
dms ipc call profiles rename <slug> <new name>
dms ipc call profiles remove <slug>
dms ipc call profiles move <slug> left|right|<position>
dms ipc call profiles reset <slug>
dms ipc call profiles previewTransition <type>
dms ipc call profiles status
```

## Traduções

O plugin está disponível em alemão, espanhol, francês, italiano, português, russo, japonês e chinês simplificado e segue o idioma definido no DMS. Se alguma tradução estiver estranha, pull requests são bem-vindos.

## Observação

Escrevi este plugin com a ajuda do Claude (Anthropic) e o uso todos os dias no meu próprio desktop.

## Licença

MIT
