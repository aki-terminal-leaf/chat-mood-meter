import { useNavigate } from 'react-router-dom';
import './Landing.css';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landing">
      {/* Header */}
      <header className="landing-header">
        <div className="landing-logo">🎭 Chat Mood Meter</div>
        <button onClick={() => navigate('/login')} className="header-login-btn">
          登入
        </button>
      </header>

      {/* Hero */}
      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">
            直播聊天室的<br />
            <span className="accent-text">情緒溫度計</span>
          </h1>
          <p className="hero-subtitle">
            即時分析觀眾情緒，捕捉每個高峰時刻，<br />
            讓你的直播數據說話。
          </p>
          <button className="primary cta-btn" onClick={() => navigate('/login')}>
            免費開始使用 →
          </button>
        </div>

        <div className="hero-visual">
          <div className="mood-preview">
            <div className="mood-bar hype">
              <span>🔥 Hype</span>
              <div className="bar-fill" style={{ width: '82%' }} />
              <span className="bar-pct">82%</span>
            </div>
            <div className="mood-bar funny">
              <span>😂 Funny</span>
              <div className="bar-fill" style={{ width: '54%' }} />
              <span className="bar-pct">54%</span>
            </div>
            <div className="mood-bar sad">
              <span>😢 Sad</span>
              <div className="bar-fill" style={{ width: '18%' }} />
              <span className="bar-pct">18%</span>
            </div>
            <div className="mood-bar angry">
              <span>😠 Angry</span>
              <div className="bar-fill" style={{ width: '9%' }} />
              <span className="bar-pct">9%</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="features">
        <div className="feature-card">
          <div className="feature-icon">⚡</div>
          <h3>即時分析</h3>
          <p>
            每 30 秒一次情緒快照，透過 WebSocket 推送，
            讓你在直播當下就能掌握觀眾狀態。
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon">✨</div>
          <h3>自動高光</h3>
          <p>
            AI 自動偵測情緒爆發時刻，標記為高光片段，
            事後剪輯再也不用看完整場錄影。
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon">📦</div>
          <h3>一鍵導出</h3>
          <p>
            支援 JSON / CSV 格式匯出，搭配時間軸數據，
            輕鬆整合進你的剪輯或數據分析流程。
          </p>
        </div>
      </section>

      {/* CTA 底部 */}
      <section className="bottom-cta">
        <h2>準備好了嗎？</h2>
        <p>連接 Twitch 或 YouTube，30 秒內開始收集數據。</p>
        <button className="primary cta-btn" onClick={() => navigate('/login')}>
          立即連結帳號
        </button>
      </section>

      <footer className="landing-footer">
        <span>Chat Mood Meter &copy; 2025</span>
      </footer>
    </div>
  );
}
