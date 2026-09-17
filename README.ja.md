# Profiles

[English](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Français](README.fr.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [Русский](README.ru.md) · **日本語** · [简体中文](README.zh_CN.md)

[DankMaterialShell](https://github.com/AvengeMedia/DankMaterialShell) 用のプラグインです。シェルの見た目に名前を付けて保存し、それらを切り替えられるようにします。プロファイルには、テーマとアクセントカラー、ライト/ダークモード、壁紙、バー、フレーム、透明度、フォント、アニメーション、デスクトップウィジェットとその位置が含まれます。

![Profiles](assets/screenshot.png)

画像付きの手順: [インストールと設定のガイド](docs/GUIDE.ja.md)。

## 切り替え

キーバインドで選択画面を開き、プロファイルを選びます。切り替え中は画面が1秒ほど止まり、その下でプロファイルが適用されてから、古い画面がアニメーションで消えます。バー、色、壁紙が順番にではなく、一度に切り替わります。

トランジションは29種類あり、フェード、ワイプ、円、ドア、ブラインド、メルト、破片、ブラウン管オフ、砂嵐、5種類のハック効果などから選べます。ランダムは好きなものだけに絞れます。ほとんどのアニメーションでは、縁が新しいプロファイルのアクセントカラーで光ります。

## プロファイル選択

選択画面には4つの表示形式があります。パネル上のストリップ、パネルなしの同じストリップ、現在のプロファイルを中央に大きく表示するカルーセル、画面いっぱいのグリッドです。プレビューの形は縦長、横長、正方形、円、六角形、ひし形から選べます。グリッドでは、六角形とひし形がウィンドウと同じ間隔でハニカム状に並びます。枠線、光、チェックマーク、角丸の半径は、オフにしたり調整したりできます。

マウスホイールと矢印キーで選択を動かし、Enter またはクリックで適用、Escape で選択画面を閉じます。

## 保存

DMS の設定で行った変更は、数秒後にアクティブなプロファイルに保存されます。各プロファイルは有効にした時点の状態を覚えているので、設定ページから変更を元に戻せます。壁紙はプロファイル内にコピーされるため、元のファイルを移動したり削除したりしても壊れません。

プロファイルは `~/.config/DankMaterialShell/profiles/` に、プロファイルごとに1つのフォルダーとして保存されます。

## 他のプラグインの設定

プラグインの設定もプロファイルに含められます。「設定 → プラグイン → Profiles → プロファイルと一緒に保存するプラグイン」にプラグイン ID を入力します。例: `audioFx`

## DMS の外にあるもの

ターミナルの色、ブラウザーのテーマ、コンポジターのルールなど、DMS が管理しないものは、2つの任意のコマンドで扱えます。

- 保存コマンドはプロファイルの保存時に実行されます。出力した JSON は `extras` としてプロファイルに保存されます。
- 適用コマンドは切り替え中、DMS が新しい設定を読み込んだ時点で実行されます。コマンドが終わると画面が表示されます。`DMS_PROFILE_DIR`、`DMS_PROFILE_SLUG`、`DMS_PROFILE_NAME`、`DMS_PROFILE_NEW_COLORS`（新しい色を生成している場合は 1）が渡されます。プロファイルのファイルは `$DMS_PROFILE_DIR/profile.json` です。

GTK のインターフェースフォントをプロファイルごとに保持する小さな例です。

```sh
# save command
printf '{"font": "%s"}' "$(gsettings get org.gnome.desktop.interface font-name | tr -d "'")"

# apply command
gsettings set org.gnome.desktop.interface font-name \
  "$(python3 -c 'import json,os; print(json.load(open(os.environ["DMS_PROFILE_DIR"] + "/profile.json"))["extras"]["font"])')"
```

## 必要なもの

DankMaterialShell 1.6.1 以降。トランジションには DMS に付属する `dms screenshot` を使います。私は niri でこのプラグインを使っています。ウィンドウの間隔、角丸の半径、ボーダーの幅は DMS 自身がコンポジターの設定に書き込むので、DMS が対応している他のコンポジターでもプロファイルに合わせて変わるはずです。

## インストール

```sh
git clone https://github.com/21Rebel/dms-profiles ~/.config/DankMaterialShell/plugins/DmsProfiles
dms ipc call plugins enable dmsProfiles
```

次にキーバインドを追加します。niri の場合の例:

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

## 翻訳

このプラグインはドイツ語、スペイン語、フランス語、イタリア語、ポルトガル語、ロシア語、日本語、簡体字中国語に対応しており、DMS で設定した言語に従います。おかしな訳があれば、プルリクエストを歓迎します。

## 補足

このプラグインは Claude (Anthropic) の助けを借りて書いたもので、自分のデスクトップで毎日使っています。

## ライセンス

MIT
