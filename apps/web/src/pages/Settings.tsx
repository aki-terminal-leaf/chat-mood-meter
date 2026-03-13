import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import './Settings.css';

interface Channel {
  id: string;
  platform: string;
  channelId: string;
  channelName: string;
  enabled: boolean;
  autoStart: boolean;
  analyzerMode: string;
}

const PLATFORM_ICON: Record<string, string> = {
  twitch: '🟣',
  youtube: '🔴',
  tiktok: '⚫',
};

const ANALYZER_MODES = [
  { value: 'standard', label: '標準' },
  { value: 'aggressive', label: '強力' },
  { value: 'minimal', label: '輕量' },
];

export default function Settings() {
  const { user, logout } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [newChannel, setNewChannel] = useState({
    platform: 'twitch',
    channelId: '',
    channelName: '',
  });
  const [addLoading, setAddLoading] = useState(false);
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    api.getChannels().then((data: { data?: Channel[] }) => setChannels(data.data || []));
  }, []);

  const addChannel = async () => {
    if (!newChannel.channelId.trim() || !newChannel.channelName.trim()) {
      setAddError('請填寫頻道 ID 和頻道名稱');
      return;
    }
    setAddError('');
    setAddLoading(true);
    try {
      const ch = await api.createChannel(newChannel);
      setChannels([...channels, ch]);
      setNewChannel({ platform: 'twitch', channelId: '', channelName: '' });
    } catch {
      setAddError('新增失敗，請再試一次');
    } finally {
      setAddLoading(false);
    }
  };

  const toggleEnabled = async (ch: Channel) => {
    await api.updateChannel(ch.id, { enabled: !ch.enabled });
    setChannels(channels.map(c => c.id === ch.id ? { ...c, enabled: !c.enabled } : c));
  };

  const toggleAutoStart = async (ch: Channel) => {
    await api.updateChannel(ch.id, { autoStart: !ch.autoStart });
    setChannels(channels.map(c => c.id === ch.id ? { ...c, autoStart: !c.autoStart } : c));
  };

  const changeAnalyzerMode = async (ch: Channel, mode: string) => {
    await api.updateChannel(ch.id, { analyzerMode: mode });
    setChannels(channels.map(c => c.id === ch.id ? { ...c, analyzerMode: mode } : c));
  };

  const deleteChannel = async (id: string) => {
    if (!confirm('確定要刪除這個頻道？')) return;
    await api.deleteChannel(id);
    setChannels(channels.filter(c => c.id !== id));
  };

  const deleteAccount = async () => {
    if (!confirm('⚠️ 確定要刪除帳號？此操作無法復原，所有資料都會消失。')) return;
    if (!confirm('再次確認：真的要刪除帳號嗎？')) return;
    setDeleteAccountLoading(true);
    try {
      await api.deleteMe();
      logout?.();
    } catch {
      alert('刪除失敗，請稍後再試');
      setDeleteAccountLoading(false);
    }
  };

  return (
    <div className="settings">
      <h1 className="settings-heading">設定</h1>

      <div className="settings-grid">
        {/* ── 帳號資訊 ── */}
        <section className="settings-card account-section">
          <h2 className="card-title">帳號資訊</h2>

          {user && (
            <div className="account-info">
              {user.avatar && (
                <img src={user.avatar} alt="avatar" className="account-avatar" />
              )}
              <div className="account-details">
                <div className="account-row">
                  <span className="account-field">用戶名</span>
                  <span className="account-value">{user.username ?? '—'}</span>
                </div>
                <div className="account-row">
                  <span className="account-field">Email</span>
                  <span className="account-value">{user.email ?? '—'}</span>
                </div>
                <div className="account-row">
                  <span className="account-field">登入方式</span>
                  <span className="account-value provider-badge">{user.provider ?? '—'}</span>
                </div>
              </div>
            </div>
          )}

          <div className="danger-zone">
            <h3 className="danger-title">危險區域</h3>
            <p className="danger-desc">刪除帳號後，所有場次、精華紀錄和設定都會永久消失。</p>
            <button
              className="btn btn-danger"
              onClick={deleteAccount}
              disabled={deleteAccountLoading}
            >
              {deleteAccountLoading ? '刪除中…' : '刪除帳號'}
            </button>
          </div>
        </section>

        {/* ── 頻道管理 ── */}
        <section className="settings-card channels-section">
          <h2 className="card-title">頻道管理</h2>

          {channels.length === 0 ? (
            <div className="empty-channels">還沒有綁定任何頻道</div>
          ) : (
            <div className="channels-list">
              {channels.map(ch => (
                <div key={ch.id} className="channel-card">
                  <div className="channel-header">
                    <span className="platform-icon">{PLATFORM_ICON[ch.platform] ?? '📺'}</span>
                    <span className="channel-name">{ch.channelName}</span>
                    <span className="channel-id">#{ch.channelId}</span>
                    <button
                      className="btn-icon btn-delete"
                      onClick={() => deleteChannel(ch.id)}
                      title="刪除頻道"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="channel-controls">
                    <label className="toggle-row">
                      <span className="toggle-label">啟用監聽</span>
                      <button
                        className={`toggle-switch ${ch.enabled ? 'on' : 'off'}`}
                        onClick={() => toggleEnabled(ch)}
                        role="switch"
                        aria-checked={ch.enabled}
                      >
                        <span className="toggle-thumb" />
                      </button>
                    </label>

                    <label className="toggle-row">
                      <span className="toggle-label">自動開始</span>
                      <button
                        className={`toggle-switch ${ch.autoStart ? 'on' : 'off'}`}
                        onClick={() => toggleAutoStart(ch)}
                        role="switch"
                        aria-checked={ch.autoStart}
                      >
                        <span className="toggle-thumb" />
                      </button>
                    </label>

                    <div className="select-row">
                      <span className="toggle-label">分析模式</span>
                      <select
                        className="mode-select"
                        value={ch.analyzerMode}
                        onChange={e => changeAnalyzerMode(ch, e.target.value)}
                      >
                        {ANALYZER_MODES.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 新增頻道表單 */}
          <div className="add-channel-form">
            <h3 className="form-title">新增頻道</h3>
            {addError && <div className="form-error">{addError}</div>}
            <div className="form-row">
              <select
                className="form-select"
                value={newChannel.platform}
                onChange={e => setNewChannel({ ...newChannel, platform: e.target.value })}
              >
                <option value="twitch">Twitch</option>
                <option value="youtube">YouTube</option>
                <option value="tiktok">TikTok</option>
              </select>
              <input
                className="form-input"
                placeholder="頻道 ID"
                value={newChannel.channelId}
                onChange={e => setNewChannel({ ...newChannel, channelId: e.target.value })}
              />
              <input
                className="form-input"
                placeholder="頻道名稱"
                value={newChannel.channelName}
                onChange={e => setNewChannel({ ...newChannel, channelName: e.target.value })}
              />
              <button
                className="btn btn-primary"
                onClick={addChannel}
                disabled={addLoading}
              >
                {addLoading ? '新增中…' : '新增'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
