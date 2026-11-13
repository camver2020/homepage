# 캠버 홈페이지 (camver.ai.kr)

정적 사이트. `src/` 를 고치고 `main` 에 올리면 GitHub Actions 가 `tools/build.py` 로 `dist/` 를 만들어 GitHub Pages 에 배포함.

## 폴더

| 위치 | 내용 |
|---|---|
| `src/pages/*.html` | 페이지 본문 (index, company, business, service, solution, cs, privacy, admin, 404) |
| `src/manage/` | 홈페이지 관리 화면(/manage/). admin 페이지 오른쪽 위 톱니로 들어감 |
| `src/partials/` | 공통 머리말·꼬리말·CSS·JS |
| `src/img/` | 이미지. `slots/` 는 칸 번호 이름(예: `company-02.jpg`), `partners/` 는 250×125 로고 |
| `src/config.json` | 도메인, 문의 폼 전송 주소, 소식 시트 주소 |
| `deploy/apps-script/Code.gs` | 문의 폼 받는 구글 Apps Script. 관리자 화면의 서버 역할도 함 |
| `tools/build.py` | 빌드. 옛 사이트 주소 이동 페이지, sitemap, robots, CNAME 도 같이 만듦 |
| `tools/test_apps_script.js` | Code.gs 점검(구글 서비스 흉내로 돌려 봄). `node tools/test_apps_script.js` |

## 자주 하는 일

- **소식 올리기**: 관리자 화면 → 소식 → 새 소식 등록. 숨김·순서 변경도 거기서. 시트 '캠버 홈페이지 소식'을 직접 고쳐도 됨(날짜, 제목, 출처, 링크, 공개). 다시 배포할 필요 없음.
- **문의 처리**: 관리자 화면 → 도입·제휴 문의 / 입사 지원·제휴. 상태·메모를 바꾸면 접수 시트에 같이 저장되고 '작업 기록' 탭에 남음.
- **문의 받는 메일 바꾸기**: 관리자 화면 → 설정 → 새 문의 알림 메일. (기본값은 `Code.gs` 의 `TO`)
- **문의 폼 주소 바꾸기**: `src/config.json` 의 `form_endpoint` 수정 → 커밋.
- **사진 바꾸기**: 같은 칸 번호 이름으로 `src/img/slots/` 에 덮어쓰기 → 커밋.

## 로컬에서 보기

```
python3 tools/build.py
cd dist && python3 -m http.server 8000
```

## 관리자 화면 (/manage/)

admin 페이지 오른쪽 위 톱니를 누르면 들어감. 구글 로그인으로 camver2020@gmail.com 계정만 들어올 수 있고, 로그인할 때 적은 담당자 이름이 작업 기록에 계정과 같이 남음.

새 서버나 DB 없이 지금 쓰는 구글 시트 2개를 그대로 씀.

| 데이터 | 저장 위치 |
|---|---|
| 문의·입사 지원, 상태·메모·처리자 | '캠버 홈페이지 문의 접수' 시트 (오른쪽 끝에 접수번호·상태·담당자 메모·최근 처리자·최근 처리 시각 칸) |
| 작업 기록 | 같은 시트의 '작업 기록' 탭 |
| 소식, 공개 여부, 순서 | '캠버 홈페이지 소식' 시트 첫 번째 탭 (5번째 칸 '공개') |
| 사용법 영상 재생목록 링크 | 소식 시트 '설정' 탭 (홈페이지가 공개로 읽음) |
| 새 문의 알림 메일 주소 | Apps Script 스크립트 속성 `NOTIFY_TO` (공개 안 됨) |

### 처음 연결하는 순서 (한 번만)

1. **구글 로그인 클라이언트 ID 만들기** (camver2020 계정으로)
   - console.cloud.google.com → 프로젝트 새로 만들기(이름 예: camver-homepage)
   - Google 인증 플랫폼(Google Auth Platform) → 브랜딩: 앱 이름 '캠버 홈페이지 관리', 지원 이메일 camver2020@gmail.com
   - 대상(Audience): 외부. 테스트 상태로 둘 거면 테스트 사용자에 camver2020@gmail.com 추가
   - 클라이언트(Clients) → 클라이언트 만들기 → 유형 '웹 애플리케이션' → 승인된 자바스크립트 원본에 `https://www.camver.ai.kr` 추가 → 만들기
   - 나온 클라이언트 ID(…apps.googleusercontent.com)를 복사. 비밀번호(시크릿)는 안 씀. 반영까지 몇 분 걸릴 수 있음
2. **Apps Script 바꾸기**: `deploy/apps-script/Code.gs` 맨 위 안내대로. 통째로 붙여넣고 `CLIENT_ID` 채우기 → `setup` 한 번 실행·권한 허용 → 배포 관리에서 새 버전으로 배포(주소 그대로)
3. **홈페이지 설정**: `src/config.json` 의 `google_client_id` 에 같은 값 넣고 커밋
4. **확인**: 고객센터에서 테스트 문의 1건 보내고 → admin 페이지 톱니 → 로그인 → 방금 문의가 보이는지, 상태를 바꾸면 시트에 반영되는지 확인

`google_client_id` 가 비어 있으면 관리자 화면은 '설정 전' 안내만 보이고, 폼 접수는 지금처럼 그대로 됨.

