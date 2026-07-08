# Knowledge Base — Puppeteer / Playwright Debugging on SeaArt

## 問題: `#easyGenerateInput` にフォーカスできない

### 事象

```text
Error: Failed to focus #easyGenerateInput after 6 attempts.
  lastError=Waiting for selector `#easyGenerateInput` failed
  debug={boundingClientRect: {x:0,y:0,width:0,height:0}, display:"block", visibility:"visible", opacity:"1"}
```

要素自体は DOM に存在するが `getBoundingClientRect()` が 0×0 を返す。`computedStyle` 上は `display: block`, `visibility: visible` にもかかわらず描画されていない状態。

### 原因

- 親要素 `div.el-textarea.top-input-area-input` が **`display: none`**
- `waitForSelector(selector, { visible: true })` は **`boundingClientRect` が非ゼロ**であることを要求するため、親が `display: none` だと常にタイムアウト
- 要素自身の `computedStyle.display` は `block` でも、親が `display: none` だと子の `getBoundingClientRect` は 0×0 になる

### 対策

1. **`{ visible: true }` を外す** — 代わりに存在確認だけ行い、後段で自前の可視性チェックを行う
2. **祖先の `display` をチェックする** — 要素自身の computedStyle ではなく親を辿って `display: none` を検出
3. **`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')` で値を設定する** — 単なる `el.value = val` は Vue のリアクティブシステムをバイパスできるが、Vue が後から上書きすることがある。ネイティブの値セッターを使うと Vue の v-model も正しく更新される
4. 値設定時は `input` + `change` イベントを必ず dispatch する

```javascript
// ✅ 正: ネイティブセッター + イベント
const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
if (desc && desc.set) desc.set.call(el, val);
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));

// ❌ ダメな例: 単なる代入 + イベントなし (Vueに上書きされる)
el.value = val;
```

---

## 問題: ページに複数のテキストエリアがあり、アクティブなものが動的に変わる

### 事象

`.top-input-area` 内に以下のテキストエリアが共存する：

| テキストエリア | 状態 | 役割 |
|---|---|---|
| `#easyGenerateInput` | `display: none` (親ごと非表示) | Easy モード用 |
| `#el-id-1024-XXX` (ID 可変) | 表示中 | Hybrid Gen モード用 |
| `.prompt-input.image-upload-prompt-input` | 表示中 | 画像アップロード用 |

どのテキストエリアがアクティブかは URL の `model_ver_no` パラメータやユーザーの選択によって変わる。

### 対策

**特定のテキストエリアに依存せず、`.top-input-area` 内の全テキストエリアに値をセットする。**

```javascript
page.evaluate(val => {
  const container = document.querySelector('.top-input-area');
  const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
  container.querySelectorAll('textarea').forEach(el => {
    if (desc && desc.set) desc.set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}, prompt);
```

これにより:
- どのモードがアクティブでも値が設定される
- 裏で値が共有されている場合、Vue/Pinia ストア経由で他のテキストエリアにも反映される
- `page.keyboard.type()` のようにフォーカスを必要としない

---

## デバッグ手法

### 1. 外部 Chrome に playwright-cli で接続して DOM 確認

```bash
# 既存の Chrome (--remote-debugging-port=9222) に接続
playwright-cli attach --cdp=http://127.0.0.1:9222

# タブ一覧
playwright-cli tab-list

# 該当タブに切り替え
playwright-cli tab-select 1

# スナップショット取得 (構造確認)
playwright-cli snapshot --depth=4 --boxes

# JavaScript を eval して詳細調査
playwright-cli eval "document.querySelector('#easyGenerateInput')?.getBoundingClientRect()"
```

### 2. 要素の祖先パスを辿って非表示の原因を特定

```javascript
// 要素から body まで辿り、各祖先の display, offsetWidth, offsetHeight を取得
const path = [];
let node = el.parentElement;
while (node && node !== document.body) {
  const style = window.getComputedStyle(node);
  path.push({
    tag: node.tagName,
    id: node.id,
    className: (node.className || '').substring(0, 60),
    display: style.display,
    w: node.offsetWidth,
    h: node.offsetHeight,
    overflow: style.overflow
  });
  node = node.parentElement;
}
```

### 3. ネットワークリクエストの傍受

`page.on('request')` / `page.on('response')` で API 通信を監視。特に以下のエンドポイントが重要:

| エンドポイント | 用途 |
|---|---|
| `POST /api/v1/tool/prompt/rand` | ランダムプロンプトの取得 |
| `POST /api/v1/task/v2/text-to-img` | 画像生成リクエスト (リクエストボディに実際に使われる prompt が含まれる) |

### 4. 専用のデバッグスクリプトを `src/` 外に作成

- 問題を切り分けるため、`/tmp/` やプロジェクトルートに独立したスクリプトを作成
- `puppeteer-core` はプロジェクトの `node_modules` から読み込む (`require()` のパスに注意)
- 1回のスクリプトで複数の状態をチェックする（wait timing, DOM state, API payload）

---

## 補足: Vue 製 SPA との戦い方

### v-model とリアクティビティ

Vue の `v-model` は通常の `el.value = val` だけでは更新されない。
`input` イベントを dispatch する必要があるが、Vue 3 ではイベントが非 Trusted (`isTrusted === false`) だと無視される実装もある。

**解決策**: 上記の `Object.getOwnPropertyDescriptor` + ネイティブセッター + input/change イベントの組み合わせでほぼ確実に動作する。

### 仮想スクロール (virtual list)

生成結果の画像一覧は `.scroll-wrapper` → `.vl-render-list` という仮想リスト構造になっている。

```html
<div class="scroll-wrapper">
  <div class="vl-spacer" style="height: 17347px;"></div>
  <div class="vl-render-list" style="transform: translate3d(0px, 12489px, 0px);">
    <div class="c-easy-msg-item" data-vl-id="...">
      ...
    </div>
  </div>
</div>
```

**重要なポイント**:
- `.c-easy-msg-item` は `.scroll-wrapper` の直接の子ではない (`>` セレクタが使えない)
- データ ID は `data-vl-id` 属性にある (`data-id` ではない)
- スクロールして仮想リストにアイテムを materialize させる必要がある
- セレクタは `.scroll-wrapper .c-easy-msg-item` のように子孫セレクタを使う

### ID の可変性

`#el-id-1024-XXX` のような ID はページをリロードするたびに変わる。固定の ID に依存せず、クラス名や構造で要素を特定する。

---

## チェックリスト: Puppeteer で操作できないとき

- [ ] `page.waitForSelector()` の `{ visible: true }` が原因でないか → boundingClientRect を確認
- [ ] 要素自身の computedStyle だけでなく、**祖先の computedStyle** も確認
- [ ] 同じコンテナ内に類似の要素が複数ないか → 別のモード/タブ用の要素が表示されている
- [ ] iframe や Shadow DOM の中にないか
- [ ] Vue 等のフレームワークが値を上書きしていないか → input/change イベントを dispatch、必要ならネイティブセッターを使用
- [ ] `page.keyboard.type()` より `page.evaluate()` + 値セットの方が確実な場合がある（特にフォーカス不要）

---

## SeaArt デイリーチャレンジ投稿フロー変更 (2026-07)

### 旧フロー (2026-06 以前)
```
.go-submit-btn をクリック
  → .selector-for-work モーダルが開く（画像一覧 / waterfall）
  → 画像を選択 → .confirm-btn
  → .publish-work モーダルでタイトル・説明入力
  → .confirm-btn で投稿
```

### 新フロー (2026-07 以降)
```
.go-submit-btn をクリック
  → .contribution-popup が開く（統合投稿モーダル）
  → .resource-item .add-btn をクリック
    → .resource-selector が開く（旧 .selector-for-work と同等）
    → 画像を選択 → .confirm-btn
  → .contribution-popup 内でタイトル・説明入力
  → .publish-footer-bar .confirm-btn で投稿
```

### 変更点まとめ

| 役割 | 旧セレクタ | 新セレクタ |
|---|---|---|
| 画像一覧モーダル | `.selector-for-work` (go-submit-btn直後) | `.resource-selector` (add-btn経由) |
| 画像アイテム | `.selector-for-work .waterfall-wrapper .waterfall-item-wrapper` | `.resource-selector .selector-for-work .waterfall-wrapper .waterfall-item-wrapper` |
| 画像選択後確認 | `.selector-for-work .footer .operation .confirm-btn` | `.resource-selector .selector-footer .operation .confirm-btn` |
| タイトル入力 | `.publish-work .el-form-item__content > .el-input .el-input__inner` | `.publish-form-title .title-input .el-input__inner` |
| 説明入力 | `.editor-container` | `.post-rich-editor .ql-editor` |
| 投稿ボタン | `.publish-work .confirm-btn` | `.publish-footer-bar .confirm-btn` |
| モーダル終了待ち | `.publish-work` が非表示 | `.contribution-popup` が非表示 |

### 注意点

- `.go-submit-btn` をクリックすると旧来の画像セレクターではなく `.contribution-popup` が開く
- 画像選択は `.resource-item .add-btn` をクリックして開く `.resource-selector` 内で行う
- `.resource-selector` 内の `.selector-for-work` の構造は旧フローとほぼ同じ（background-image で画像IDを照合）
- `.confirm-btn` は画像未選択時は `disabled` クラスが付くので `:not(.disabled)` で待つ必要がある
