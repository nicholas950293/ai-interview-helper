import { SessionGate } from '../../SessionGate';

/** `/s/[token]` —— 邀請連結的入口，兌換後即把 token 自網址移除。 */
export default async function RedeemPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SessionGate token={decodeURIComponent(token)} />;
}
