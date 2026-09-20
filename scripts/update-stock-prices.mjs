#!/usr/bin/env node
// GitHub Actions cron이 매 평일 오후 실행. 보유 종목 목록은 브라우저 localStorage에만
// 있으므로, 이미 연결된 Supabase 동기화 테이블(wealth_data)에서 읽어온 뒤
// 공공데이터포털 금융위원회_주식시세정보 API로 종가를 조회해 되돌려 쓴다.
// 되돌려 쓸 때는 update_stock_prices RPC(Postgres 함수)를 통해 stocks 필드만
// jsonb_set으로 교체한다 — 그 사이 앱에서 바뀐 다른 필드(tx, profile 등)를
// 통째로 덮어쓰지 않기 위함. RPC 정의는 README.md 참고.

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`환경변수 ${name}가 없습니다. GitHub repo Settings → Secrets에서 확인하세요.`);
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const SYNC_CODE = requireEnv("SYNC_CODE");
const DATA_GO_KR_KEY = requireEnv("DATA_GO_KR_KEY");

function ymd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchRow() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/wealth_data?id=eq.${encodeURIComponent(SYNC_CODE)}&select=data`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!res.ok) throw new Error(`Supabase 조회 실패: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`동기화 코드 "${SYNC_CODE}"에 해당하는 데이터가 없습니다.`);
  return rows[0].data;
}

// 한국 종목코드는 항상 6자리(앞자리 0 포함)인데, 사용자가 입력할 때 앞자리 0이
// 빠질 수 있다(예: "83561" → 실제로는 "083561"). data.go.kr의 likeSrtnCd는 앞자리
// 일치(prefix) 검색이라 0이 빠지면 아예 매칭이 안 되므로 여기서 보정한다.
function normalizeCode(code) {
  return /^[0-9]+$/.test(code) ? code.padStart(6, "0") : code;
}

async function fetchLatestPrice(rawCode) {
  const code = normalizeCode(rawCode);
  const end = new Date();
  const begin = new Date(end.getTime() - 9 * 86400000);
  const params = new URLSearchParams({
    serviceKey: DATA_GO_KR_KEY,
    numOfRows: "20",
    pageNo: "1",
    resultType: "json",
    likeSrtnCd: code,
    beginBasDt: ymd(begin),
    endBasDt: ymd(end),
  });
  const url = `https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const header = json?.response?.header;
  if (header && header.resultCode !== "00") throw new Error(header.resultMsg || "API 오류");
  const raw = json?.response?.body?.items?.item;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  // likeSrtnCd는 앞자리 일치라 비슷한 코드가 여러 개 걸릴 수 있으므로 정확히 일치하는 것만 남긴다.
  const exact = list.filter((x) => x.srtnCd === code);
  if (!exact.length) return null;
  exact.sort((a, b) => b.basDt.localeCompare(a.basDt));
  const latest = exact[0];
  return {
    price: parseInt(latest.clpr, 10),
    date: `${latest.basDt.slice(0, 4)}-${latest.basDt.slice(4, 6)}-${latest.basDt.slice(6, 8)}`,
  };
}

async function pushStocks(stocks) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_stock_prices`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
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
      st.currentPrice = result.price;
      st.priceDate = result.date;
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
