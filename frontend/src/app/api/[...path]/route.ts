import type { NextRequest } from 'next/server';

/**
 * BFF 代理（取代 next.config 的 rewrites）。
 *
 * 為什麼不用 rewrites：它在 **build 時**求值並寫進 routes-manifest.json，
 * standalone 伺服器不會於執行時重新讀取。後端位址因此被烘進映像，
 * 一份映像只能對應一個環境；部署平台若把 BACKEND_ORIGIN 設成執行時變數，
 * 前端會安靜地繼續打 localhost:8787——部署成功、API 全掛，很難查。
 *
 * 改成 Route Handler 後 `BACKEND_ORIGIN` 是普通的執行時變數，同一份映像
 * 在本機、compose、任何 PaaS 上都能用，不必為了換後端位址重新建置。
 *
 * 前端仍然永不直接呼叫模型服務，也永不持有任何憑證（憲章「憑證隔離」）——
 * 這裡只是把請求原樣轉給後端。
 */

// 每個請求都要即時轉發，不得快取或預先產生
export const dynamic = 'force-dynamic';
// SSE 需要 Node 執行環境的串流能力
export const runtime = 'nodejs';

/**
 * 後端位址。容忍沒有 scheme 的寫法——部署平台常以「主機:埠」的形式提供
 * 服務間位址（Render 的 `fromService property: hostport` 就是），
 * 少了 scheme 會讓 `new URL()` 直接擲錯。
 *
 * 補 scheme 的規則：有明確埠號視為叢集內部通訊（http），
 * 只有主機名則視為對外網址（https）。
 */
function backendOrigin(): string {
  const raw = (process.env.BACKEND_ORIGIN ?? 'http://localhost:8787').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${/:\d+$/.test(raw) ? 'http' : 'https'}://${raw}`;
}

/**
 * 逐跳（hop-by-hop）標頭不得轉發——它們描述的是「這一段連線」而非訊息本身。
 * 轉發 `connection` / `transfer-encoding` 會讓下游對串流的解讀出錯。
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function filterHeaders(source: Headers): Headers {
  const out = new Headers();
  source.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.append(key, value);
  });
  return out;
}

async function proxy(request: NextRequest): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, backendOrigin());

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: filterHeaders(request.headers),
      body: hasBody ? request.body : undefined,
      // 串流請求需要；Node 的 fetch 對 ReadableStream body 要求明示
      ...(hasBody ? { duplex: 'half' } : {}),
      redirect: 'manual',
      // AI 串流可長達數十秒（實測完整實作 73 秒），MUST NOT 提早中止。
      // 逾時交給後端的 AI_FIRST_TOKEN_TIMEOUT_MS 判斷——它會送出帶原因的
      // error 事件，比連線被砍掉有用得多。
      signal: AbortSignal.timeout(180_000),
    } as RequestInit);
  } catch (err) {
    // 記錄真正的原因：後端沒起來、DNS 解不開、逾時，在畫面上都是同一句話，
    // 只有伺服器日誌分得出來。這一課是串流那次學到的。
    console.error(`[proxy] ${request.method} ${target.pathname} 失敗:`, err);
    return Response.json(
      {
        error: {
          code: 'AI_UNAVAILABLE',
          message: '目前無法連線至伺服器，你的作答內容不受影響，稍後可再試一次。',
        },
      },
      { status: 502 }
    );
  }

  // 直接回傳上游的 body 串流，不做任何緩衝——緩衝會讓 SSE 變成「等全部跑完
  // 才一次顯示」，逐字串流的體驗就消失了。
  const headers = filterHeaders(upstream.headers);
  // Nginx 類的中介層看到這個才不會自行緩衝 SSE
  if (headers.get('content-type')?.includes('text/event-stream')) {
    headers.set('x-accel-buffering', 'no');
    headers.set('cache-control', 'no-cache, no-transform');
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
