import { Icon, PlatformIcon } from "./icons";

export function TwitchSettings({ account, status, pending, device, busy, onLogin, onCancel, onLogout }: {
  account: { configured: boolean; connected: boolean; name: string };
  status: string;
  pending: string | null;
  device?: { userCode: string; expiresAt: number } | null;
  busy: boolean;
  onLogin: () => void;
  onCancel: () => void;
  onLogout: () => void;
}) {
  return (
    <section className="panel account-card twitch-account">
      <div className="panel-heading">
        <div className="platform-heading">
          <span className="platform-avatar"><PlatformIcon platform="twitch" size={27} /></span>
          <div>
            <h2>트위치</h2>
            <span title={account.name}>{account.connected ? account.name : "채팅·추첨·숫자 투표"}</span>
          </div>
        </div>
        <span className={account.connected ? "tag twitch-tag" : "tag"}>{account.connected ? "계정 연결됨" : "계정 미연결"}</span>
      </div>
      {(!account.connected || pending === "twitch") && <div className="youtube-connect-info">
        <Icon name={account.connected ? "check" : "link"} size={20} />
        <div>
          {!account.connected && <p>본인 방송 계정으로 채팅 읽기를 승인하세요.</p>}
          {pending === "twitch" && device && <p className="device-code" role="status">승인 코드 <code>{device.userCode}</code></p>}
        </div>
      </div>}
      <div className="actions">
        <button className="primary twitch-button" disabled={busy || !!pending || !account.configured} onClick={onLogin}>
          <PlatformIcon platform="twitch" size={18} />
          {pending === "twitch" ? "브라우저에서 로그인 중…" : account.connected ? "계정 다시 연결" : "트위치 로그인"}
        </button>
        {pending === "twitch" && <button className="text-button" onClick={onCancel}>로그인 취소</button>}
        {account.connected && !pending && <button className="secondary" disabled={busy} onClick={onLogout}>계정 연결 해제</button>}
      </div>
      {!account.configured && <p className="config-hint">앱의 트위치 연결 설정이 준비 중입니다.</p>}
      <div className="account-footer">
        <div className="account-status" title={status}><i className={status === "연결됨" ? "dot purple" : "dot"} />채팅 · {status}</div>
        <details className="account-help">
          <summary>연결 안내 <Icon name="arrow" size={12} /></summary>
          <div className="info-popover"><p>본인 채널의 채팅을 수신합니다. 구독자 전용 추첨과 숫자 투표를 사용할 수 있으며, 도네 투표는 아직 지원하지 않습니다.</p></div>
        </details>
      </div>
    </section>
  );
}
