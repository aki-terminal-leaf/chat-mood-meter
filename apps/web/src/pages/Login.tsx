import './Login.css';

export default function Login() {
  const handleTwitch = () => {
    window.location.href = '/auth/twitch';
  };

  const handleYouTube = () => {
    window.location.href = '/auth/youtube';
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-logo">🎭</div>
        <h1 className="login-title">Chat Mood Meter</h1>
        <p className="login-subtitle">連結你的直播帳號，開始分析觀眾情緒</p>

        <div className="login-buttons">
          <button className="login-btn twitch-btn" onClick={handleTwitch}>
            <span className="btn-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
              </svg>
            </span>
            Login with Twitch
          </button>

          <button className="login-btn youtube-btn" onClick={handleYouTube}>
            <span className="btn-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/>
              </svg>
            </span>
            Login with YouTube
          </button>
        </div>

        <p className="login-note">
          登入即表示你同意我們存取公開的聊天室資料
        </p>
      </div>
    </div>
  );
}
