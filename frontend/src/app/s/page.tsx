import { SessionGate } from '../SessionGate';

/**
 * `/s` —— token 已兌換後的常駐網址。
 *
 * 重新整理與返回都落在這裡；場次由 cookie 還原，網址上不再帶 token
 * （避免邀請連結留在瀏覽器歷史或被轉傳）。
 */
export default function SessionPage() {
  return <SessionGate token={null} />;
}
