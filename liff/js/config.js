/**
 * config.js
 * 公開してよいクライアント設定のみを管理する（秘密情報は置かない）。
 *
 * 設定方法（いずれか）:
 *  1) 下の LIFF_ID / API_URL を直接記入する（ビルド時設定）。
 *  2) API_URL のみ記入し、LIFF_ID は空のままにする。
 *     その場合、GAS の getConfig から実行時に LIFF_ID を取得する
 *     （GAS 側スクリプトプロパティ LIFF_ID を使用）。
 */
window.APP_CONFIG = {
  // LINE Developers で発行した LIFF ID（例: 1234567890-abcdEFGH）
  LIFF_ID: '2010856238-fSE3RDyL',

  // GAS Web アプリのデプロイURL（/exec で終わるURL）
  API_URL: 'https://script.google.com/macros/s/AKfycbzzQW4YzQg1DyTUvdBZLiO1D1tECVjvqId2WwkvbXVKvmiPU56xBC4BtFiKb_GHurun/exec',

  // 通信タイムアウト（ミリ秒）
  TIMEOUT_MS: 15000,

  // LIFF 初期化タイムアウト（ミリ秒）— これを超えたらエラー画面へ
  INIT_TIMEOUT_MS: 12000
};
