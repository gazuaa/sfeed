import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { openInstallHelp, promptInstall, useInstallState } from '../client/pwa';

export function InstallAppButton() {
  const state = useInstallState();
  if (state === 'installed') return null;
  return <button type="button" onClick={openInstallHelp} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-emerald-500 hover:bg-emerald-500/10 cursor-pointer"><Download size={16} />앱 설치</button>;
}

export function PwaInstall() {
  const state = useInstallState();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return Date.now() - Number(localStorage.getItem('sfeed:install-snooze') || 0) < 86400000; } catch { return false; } });
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const act = async () => { if (!(await promptInstall())) setOpen(true); };
  useEffect(() => { const show = () => setOpen(true); window.addEventListener('sfeed:install', show); return () => window.removeEventListener('sfeed:install', show); }, []);
  useEffect(() => { if (open) { dialog.current?.showModal(); closeButton.current?.focus(); } else dialog.current?.close(); }, [open]);
  useEffect(() => { if (state === 'installed') setOpen(false); }, [state]);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent);
  return <>
    {state !== 'installed' && !hidden && <aside className="sfeed-install-banner" aria-label="앱 설치 안내">
      <img src="/icons/icon-192.png" alt="" width="40" height="40" />
      <div className="min-w-0 flex-1"><strong className="block text-sm">Sfeed를 앱으로 사용하세요</strong><p className="text-xs text-slate-400 mt-1">홈 화면에서 바로 열고 편하게 읽으세요.</p></div>
      <button type="button" onClick={() => { void act(); }} className="shrink-0 bg-emerald-500 text-slate-950 rounded-xl px-3 py-2 text-xs font-bold cursor-pointer">{state === 'prompt' ? '설치' : '설치 방법'}</button>
      <button type="button" aria-label="설치 안내 하루 동안 숨기기" onClick={() => { setHidden(true); try { localStorage.setItem('sfeed:install-snooze', String(Date.now())); } catch {} }} className="text-slate-400 p-1 cursor-pointer"><X size={16} /></button>
    </aside>}
    <dialog ref={dialog} aria-labelledby="install-title" className="sfeed-install-dialog" onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={(event) => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) setOpen(false); } }}>
      <div className="flex items-center gap-3 mb-5"><img src="/icons/icon-192.png" alt="" width="44" height="44" /><h2 id="install-title" className="text-xl font-bold">Sfeed 앱 설치</h2></div>
      <p className="text-sm text-slate-400 leading-6 mb-5">홈 화면이나 Dock에서 브라우저 주소창 없이 Sfeed를 열 수 있어요.</p>
      <ol className="list-decimal pl-5 space-y-3 text-sm leading-6">
        {ios ? <><li>브라우저의 <strong>공유</strong> 버튼을 누르세요.</li><li><strong>홈 화면에 추가</strong>를 선택하세요. 항목이 없으면 Safari에서 이 페이지를 열어 주세요.</li><li><strong>웹 앱으로 열기</strong>가 보이면 켠 뒤 <strong>추가</strong>를 누르세요.</li></> : safari ? <><li>Safari 메뉴 막대에서 <strong>파일 → Dock에 추가…</strong>를 선택하세요.</li><li>이름을 확인하고 <strong>추가</strong>를 누르세요.</li></> : <><li>Chrome·Edge의 주소창 오른쪽 <strong>설치 아이콘</strong>을 누르세요.</li><li>아이콘이 없으면 브라우저 메뉴의 <strong>Sfeed 설치</strong> 또는 <strong>앱 설치</strong>를 선택하세요.</li><li>다른 브라우저에서는 Chrome·Edge 또는 Safari로 열어 주세요.</li></>}
      </ol>
      <p className="mt-5 text-xs text-slate-400 leading-5">설치한 앱에서는 Google 로그인이 다시 필요할 수 있어요. 같은 계정으로 로그인하면 구독과 읽음 상태가 이어집니다.</p>
      <div className="flex justify-end gap-2 mt-6">{state === 'prompt' && <button type="button" onClick={() => { void act(); }} className="rounded-xl border border-emerald-500 text-emerald-400 px-5 py-2.5 text-sm font-bold cursor-pointer">지금 설치</button>}<button ref={closeButton} type="button" onClick={() => setOpen(false)} className="rounded-xl bg-emerald-500 text-slate-950 px-5 py-2.5 text-sm font-bold cursor-pointer">알겠어요</button></div>
    </dialog>
  </>;
}
