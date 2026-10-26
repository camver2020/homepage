# 캠버 홈페이지 (camver.co.kr)

정적 사이트. `src/` 를 고치고 `main` 에 올리면 GitHub Actions 가 `tools/build.py` 로 `dist/` 를 만들어 GitHub Pages 에 배포함.

## 폴더

| 위치 | 내용 |
|---|---|
| `src/pages/*.html` | 페이지 본문 (index, company, business, service, solution, cs, privacy, admin, 404) |
| `src/partials/` | 공통 머리말·꼬리말·CSS·JS |
| `src/img/` | 이미지. `slots/` 는 칸 번호 이름(예: `company-02.jpg`), `partners/` 는 250×125 로고 |
| `src/config.json` | 도메인, 문의 폼 전송 주소, 소식 시트 주소 |
| `deploy/apps-script/Code.gs` | 문의 폼 받는 구글 Apps Script |
| `tools/build.py` | 빌드. 옛 사이트 주소 이동 페이지, sitemap, robots, CNAME 도 같이 만듦 |

## 자주 하는 일

- **소식 올리기**: 구글 시트 '캠버 홈페이지 소식'에 한 줄 추가 (날짜, 제목, 출처, 링크). 다시 배포할 필요 없음. 시트 순서 그대로 보이니까 새 소식은 2번째 줄에 끼워 넣기.
- **문의 받는 메일 바꾸기**: `Code.gs` 의 `TO` 수정 → Apps Script 에서 새 버전으로 배포.
- **문의 폼 주소 바꾸기**: `src/config.json` 의 `form_endpoint` 수정 → 커밋.
- **사진 바꾸기**: 같은 칸 번호 이름으로 `src/img/slots/` 에 덮어쓰기 → 커밋.

## 로컬에서 보기

```
python3 tools/build.py
cd dist && python3 -m http.server 8000
```
