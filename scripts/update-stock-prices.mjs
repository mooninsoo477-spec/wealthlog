#!/usr/bin/env node
// GitHub Actions cron이 매 평일 장 마감 뒤 실행. 보유 종목 목록은 브라우저
// localStorage에만 있으므로, 연결된 Supabase 동기화 테이블(wealth_data)에서
// 읽어온 뒤 Yahoo Finance 일봉의 마지막 종가를 조회해 되돌려 쓴다.
// 되돌려 쓸 때는 update_stock_prices RPC(Postgres 함수)를 통해 stocks 필드만
// jsonb_set으로 교체한다 — 그 사이 앱에서 바뀐 다른 필드(tx, profile 등)를
// 통째로 덮어쓰지 않기 위함. RPC 정의는 supabase/setup-stock-price-rpc.sql 참고.

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`환경변수 ${name}가 없습니다. GitHub repo Settings → Secrets에서 확인하세요.`);
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_SECRET_KEY = requireEnv("SUPABASE_SECRET_KEY");
const SYNC_CODE = requireEnv("SYNC_CODE");

// 새 Supabase Secret key는 JWT가 아니므로 Authorization 헤더가 아니라
// apikey 헤더에만 보낸다. 키는 GitHub Secrets에만 저장한다.
const supabaseHeaders = { apikey: SUPABASE_SECRET_KEY };

async function fetchRow() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/wealth_data?id=eq.${encodeURIComponent(SYNC_CODE)}&select=data`,
    { headers: supabaseHeaders }
  );
  if (!res.ok) throw new Error(`Supabase 조회 실패: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`동기화 코드 "${SYNC_CODE}"에 해당하는 데이터가 없습니다.`);
  return rows[0].data;
}

// 한국 종목코드는 항상 6자리(앞자리 0 포함)다.
function normalizeCode(code) {
  const value = String(code || "").trim().toUpperCase();
  return /^[0-9]+$/.test(value) ? value.padStart(6, "0") : value;
}

function dateInKorea(unixSeconds) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(unixSeconds * 1000));
  const value = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function fetchYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10d&interval=1d&events=history`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Wealthlog/1.0" } });
  if (!res.ok) return null;
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  for (let i = Math.min(timestamps.length, closes.length) - 1; i >= 0; i--) {
    const price = Number(closes[i]);
    if (Number.isFinite(price) && price > 0) {
      return { price: Math.round(price), date: dateInKorea(timestamps[i]), symbol };
    }
  }
  return null;
}

async function fetchLatestPrice(rawCode) {
  const code = normalizeCode(rawCode);
  if (!/^\d{6}$/.test(code)) return null;

  // 코스피·ETF(.KS)를 먼저 보고 없으면 코스닥(.KQ)을 확인한다.
  for (const suffix of [".KS", ".KQ"]) {
    const result = await fetchYahoo(code + suffix);
    if (result) return result;
  }
  return null;
}

async function pushStocks(stocks) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_stock_prices`, {
    method: "POST",
    headers: {
      ...supabaseHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_id: SYNC_CODE, p_stocks: stocks }),
  });
  if (!res.ok) throw new Error(`Supabase 갱신 실패: ${res.status} ${await res.text()}`);
}

async function main() {
  const data = await fetchRow();
  const stocks = Array.isArray(data.stocks) ? data.stocks : [];
  if (!stocks.length) {
    console.log("보유 종목이 없습니다. 종료.");
    return;
  }

  let updated = 0;
  const failed = [];
  for (const st of stocks) {
    if (!st.code) continue;
    try {
      const result = await fetchLatestPrice(st.code);
      if (!result) {
        failed.push(`${st.name || st.code}(데이터 없음)`);
        continue;
      }
      if (!Number.isFinite(result.price) || result.price <= 0) {
        failed.push(`${st.name || st.code}(잘못된 종가)`);
        continue;
      }
      // 휴일이나 API 지연으로 더 오래된 값이 돌아오면 현재 값을 덮어쓰지 않는다.
      if (st.priceDate && result.date < st.priceDate) {
        failed.push(`${st.name || st.code}(기존 날짜보다 오래된 데이터)`);
        continue;
      }
      st.currentPrice = result.price;
      st.priceDate = result.date;
      st.priceSource = "Yahoo Finance";
      st.err = null;
      updated++;
    } catch (e) {
      failed.push(`${st.name || st.code}(${e.message})`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  await pushStocks(stocks);
  const summary = `갱신 완료: ${updated}개 성공, ${failed.length}개 실패${failed.length ? " — " + failed.join(", ") : ""}`;
  if (updated === 0 && failed.length > 0) {
    // 스크립트 자체는 안 죽었지만 실질적으로 아무 것도 갱신 못 했으므로,
    // Actions 화면에서 "성공"으로 조용히 묻히지 않도록 실패로 표시한다.
    console.error(summary);
    process.exitCode = 1;
  } else {
    console.log(summary);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
