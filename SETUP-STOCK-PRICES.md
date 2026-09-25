# 종가 자동 갱신 설정 — 처음 한 번만 하면 됩니다

이 기능은 평일 오후 4시 20분에 마지막 거래일의 한국 주식·ETF 종가를
Yahoo Finance에서 가져와 Supabase에 저장합니다. 사이트를 열면
Supabase 데이터를 자동으로 불러오므로 최신 종가가 화면에 반영됩니다.

## 준비물

- 현재 사용 중인 Supabase 프로젝트
- 이 사이트의 GitHub 저장소 관리 권한

비밀키는 공개 파일, `index.html`, 채팅에 적지 마세요. 아래 안내대로 GitHub
Secrets에만 저장합니다.

## 1. Supabase에 주식 갱신 함수 만들기

1. Supabase Dashboard에서 Wealthlog에 사용하는 프로젝트를 엽니다.
2. 왼쪽 메뉴에서 **SQL Editor**를 누릅니다.
3. **New query**를 누릅니다.
4. 이 저장소의 `supabase/setup-stock-price-rpc.sql` 내용을 전부 붙여넣습니다.
5. 오른쪽 아래 **Run**을 누릅니다.
6. `Success. No rows returned`가 표시되면 완료입니다.

## 2. Supabase 값 확인

Supabase 프로젝트에서 다음 값을 준비합니다.

- `SUPABASE_URL`: Settings → API에서 확인하는 Project URL
- `SUPABASE_SECRET_KEY`: Settings → API Keys의 `sb_secret_...` 형식 Secret key
- `SYNC_CODE`: Wealthlog 사이트의 설정 탭에서 사용 중인 동기화 코드

Secret key가 아직 보이지 않으면 Settings → API Keys에서 **Create new API keys**를
눌러 새 키를 만든 뒤 `sb_secret_...` 값을 사용합니다.

Secret key는 데이터 전체에 접근할 수 있는 서버용 열쇠입니다. 절대로 브라우저
설정이나 공개 파일에 넣지 마세요.

## 3. GitHub Secrets 세 개 등록

1. GitHub에서 `wealthlog` 저장소를 엽니다.
2. **Settings → Secrets and variables → Actions**로 이동합니다.
3. **New repository secret**을 눌러 다음 세 개를 각각 등록합니다.

| Name | 넣을 값 |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` Secret key |
| `SYNC_CODE` | Wealthlog에서 사용 중인 동기화 코드 |

## 4. 처음 한 번 직접 실행

1. GitHub 저장소의 **Actions** 탭을 엽니다.
2. 왼쪽에서 **주식 시세 자동 갱신**을 선택합니다.
3. **Run workflow → Run workflow**를 누릅니다.
4. 약 1분 뒤 실행 결과에 초록색 체크가 뜨는지 확인합니다.
5. Wealthlog 사이트를 새로고침합니다.

빨간색 X가 뜨면 해당 실행을 누르고 `종가 조회 후 Supabase 갱신` 단계의
마지막 오류 문장을 확인합니다. 비밀키 값 자체는 로그에 출력되지 않습니다.

## 평소 사용법

주식이나 ETF를 Wealthlog의 **자산** 탭에서 등록할 때 종목코드를 정확한
6자리로 입력합니다. 예: 삼성전자 `005930`, TIGER 미국나스닥100 `133690`.

그 뒤에는 별도로 누를 것이 없습니다. 평일 오후 4시 20분에 마지막 거래일 종가가
자동으로 갱신되고, 다음에 사이트를 열거나 새로고침할 때 반영됩니다.

국내 숫자·영문 혼합 종목코드와 미국주식 영문 티커를 지원합니다. 미국주식은
달러 종가와 원/달러 환율의 마지막 값을 곱해 원화 현재가로 저장합니다.
