-- Supabase Dashboard > SQL Editor에서 한 번만 실행하세요.
-- 자동 갱신 작업이 주식 목록만 바꾸게 하여, 동시에 입력된 가계부나 설정을
-- 통째로 덮어쓰는 일을 방지합니다.

create or replace function public.update_stock_prices(
  p_id text,
  p_stocks jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.wealth_data
     set data = jsonb_set(
       coalesce(data, '{}'::jsonb),
       '{stocks}',
       coalesce(p_stocks, '[]'::jsonb),
       true
     ),
         updated_at = now()
   where id = p_id;
$$;

-- 함수는 GitHub Actions의 서버용 Secret key만 호출할 수 있게 제한합니다.
revoke execute on function public.update_stock_prices(text, jsonb) from public;
revoke execute on function public.update_stock_prices(text, jsonb) from anon;
revoke execute on function public.update_stock_prices(text, jsonb) from authenticated;
grant execute on function public.update_stock_prices(text, jsonb) to service_role;

-- 새 프로젝트는 Data API 권한이 자동으로 생기지 않을 수 있습니다.
grant select, update on table public.wealth_data to service_role;
