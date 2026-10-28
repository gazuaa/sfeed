import { useState } from 'react';
import { enableLocalNotifications, setLocalNotifications, useLocalNotifications } from '../client/localNotifications';

export function LocalNotificationSetting({ accountId }: { accountId?: string }) {
  const enabled = useLocalNotifications(accountId ?? '');
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  if (!accountId) return null;
  return <><label className="sfeed-scroll-read-setting"><span>새 글 제목 알림<small>피드명과 글 제목을 알림으로 표시</small></span><input type="checkbox" role="switch" aria-label="새 글 제목 알림" checked={enabled} disabled={pending} onChange={async (event) => {
    if (!event.target.checked) { setLocalNotifications(accountId, false); setMessage(''); return; }
    setPending(true);
    try { setMessage(await enableLocalNotifications(accountId)); } catch { setMessage('알림 권한을 확인해 주세요.'); }
    finally { setPending(false); }
  }} /></label><small className="sfeed-auto-refresh-help">이 기기에서만 적용됩니다. 앱을 완전히 종료하면 새 글을 감지하지 못하며, 백그라운드에서는 기기가 실행을 멈출 수 있습니다.</small>{message && <p className="sfeed-setting-message" role="status">{message}</p>}</>;
}
