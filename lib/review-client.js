// 手元のプレビューだけで読み込む、記事の確認欄（OK / NG とコメント）。lib/preview.mjs がページに差し込む。本番には出ない
(() => {
  const m = location.pathname.match(/^\/(en\/)?posts\/([^/]+)\/$/);
  if (!m) return;
  const key = `${m[1] ? 'en' : 'ja'}/${decodeURIComponent(m[2])}`;
  const title = (document.querySelector('h1')?.textContent ?? document.title).trim();

  const box = document.createElement('section');
  box.style.cssText = 'margin:2rem 0;padding:1rem;border:2px dashed #c80;border-radius:8px;font-size:0.95rem';
  const head = document.createElement('div');
  head.textContent = `確認（手元だけ・本番には出ない）：${key}`;
  head.style.cssText = 'font-weight:bold;margin-bottom:0.5rem';
  const buttons = document.createElement('div');
  const mk = (label, value) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.value = value;
    b.style.cssText = 'margin-right:0.5rem;padding:0.3rem 1rem;font-size:1rem;cursor:pointer';
    buttons.append(b);
    return b;
  };
  const ok = mk('OK', 'ok');
  const ng = mk('NG', 'ng');
  const clear = mk('未判断に戻す', '');
  const comment = document.createElement('textarea');
  comment.rows = 4;
  comment.placeholder = 'コメント（直してほしい点など）';
  comment.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:0.5rem 0;font:inherit';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'コメントを保存';
  save.style.cssText = 'padding:0.3rem 1rem;cursor:pointer';
  const msg = document.createElement('span');
  msg.style.cssText = 'margin-left:0.75rem';
  box.append(head, buttons, comment, save, msg);
  (document.querySelector('main') ?? document.body).append(box);

  let status = '';
  const show = () => {
    for (const b of [ok, ng, clear]) {
      const on = b.dataset.value === status && b !== clear;
      b.style.background = on ? (status === 'ok' ? '#2a7' : '#c33') : '';
      b.style.color = on ? '#fff' : '';
    }
  };

  async function send() {
    msg.textContent = '保存中…';
    try {
      const r = await fetch('/__review/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, status, comment: comment.value, title }),
      });
      if (!r.ok) throw new Error(await r.text());
      msg.textContent = `保存しました（${new Date().toLocaleTimeString()}）`;
    } catch (e) {
      msg.textContent = `保存できませんでした：${e.message}`;
    }
  }

  for (const b of [ok, ng, clear]) b.addEventListener('click', () => { status = b.dataset.value; show(); send(); });
  save.addEventListener('click', send);

  fetch('/__review/data').then((r) => r.json()).then((all) => {
    const mine = all[key];
    if (mine) {
      status = mine.status;
      comment.value = mine.comment;
      msg.textContent = `前回の保存：${new Date(mine.updated).toLocaleString()}`;
    }
    show();
  }).catch(() => { msg.textContent = '前回の内容を読めませんでした'; });
})();
