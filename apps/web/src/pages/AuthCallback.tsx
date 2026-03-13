import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './AuthCallback.css';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 檢查 URL 是否帶有錯誤參數
    const params = new URLSearchParams(window.location.search);
    const errorMsg = params.get('error');

    if (errorMsg) {
      setError(errorMsg);
      return;
    }

    // 確認登入狀態
    fetch('/api/me', { credentials: 'include' })
      .then(r => {
        if (r.ok) {
          navigate('/dashboard', { replace: true });
        } else {
          setError('登入失敗，請重試');
        }
      })
      .catch(() => {
        setError('網路錯誤，請重試');
      });
  }, [navigate]);

  if (error) {
    return (
      <div className="callback-page">
        <div className="callback-box error">
          <div className="callback-icon">❌</div>
          <h2>登入失敗</h2>
          <p className="error-msg">{error}</p>
          <button className="primary" onClick={() => navigate('/login')}>
            返回登入
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="callback-page">
      <div className="callback-box">
        <div className="callback-spinner" />
        <h2>登入中...</h2>
        <p>正在驗證身份，請稍候</p>
      </div>
    </div>
  );
}
