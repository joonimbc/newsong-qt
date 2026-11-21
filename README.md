# 오늘의 발견 큐티 (설치 없는 교회 성도용 모바일 PWA)

*Coffee Break: Leading Bible Discovery* 원칙을 바탕으로, 성도가 매일 짧은 성경 본문 앞에서 **스스로 질문하고 발견하여 삶으로 한 걸음 적용**할 수 있도록 설계된 설치 없는 모바일 웹(PWA) 프로토타입입니다.

---

## 1. 바로 실행해 보기 (별도 설치 불필요)

### 방법 A: 파일 직접 열기
- [index.html](index.html) 파일을 Chrome이나 Safari로 바로 열면 `data/fallback-data.js`를 통해 모든 기능(2일 치 말씀, 하이라이트, 어제 적용 돌아보기, 묵상 카드 복사, `.ics` 알림 다운로드 등)을 즉시 체험할 수 있습니다.

### 방법 B: 로컬 웹 서버로 실행하기 (PWA·Service Worker 테스트)
macOS에 기본 포함된 Ruby만으로 바로 실행할 수 있습니다.

```bash
cd /Users/byunghoon/.gemini/antigravity/scratch/daily-qt-pwa
ruby -run -ehttpd . -p 8080
```

브라우저에서 `http://localhost:8080` 에 접속하고, 모바일 크기로 보려면 개발자 도구(F12 / Cmd+Option+I)에서 기기 툴바를 켜세요.

---

## 2. 주간 자동 미리 등록 & 매일 새벽 05:30 자동 공개

1. **연간/월간 성경 읽기표 내장 ([data/reading_plan.json](data/reading_plan.json))**
   - 성서유니온 《매일성경 읽기표》 기준 **2026년 11~12월 및 2027년 1~12월 전체(총 426일 치: `2026-11-01` ~ `2027-12-31`)** 장·절이 `data/reading_plan.json`에 미리 저장·검증되어 있습니다. (2028년 이후에도 새 읽기표만 이어서 추가하면 됩니다.)
2. **매주 정해진 시간에 1주일 치 자동 미리 등록 ([.github/workflows/weekly-generate.yml](.github/workflows/weekly-generate.yml))**
   - GitHub 저장소 `Settings → Secrets and variables → Actions`에 무료 발급한 **`GEMINI_API_KEY`**([Google AI Studio](https://aistudio.google.com/apikey)) 1개만 등록해 두면 됩니다.
   - **매주 토요일 오전 06:00(KST)**(`cron: '0 21 * * 5'` UTC, 원하는 요일·시간으로 변경 가능)에 `scripts/generate_week.rb`가 자동으로 실행되어 다음 7일 치 본문(개역한글·BSB 내장 원문 자동 입력)과 **쉬운(3)·중간(4)·고급(6)** 질문·적용을 미리 생성해 `data/days/`에 등록합니다.
   - 담당 목회자는 주말 동안 생성된 파일을 가볍게 살펴보거나 필요한 문구만 다듬을 수 있습니다. (수동 제작 시에는 `ruby scripts/new_day.rb --date YYYY-MM-DD --ref "시편 22:22-31"` 사용)
3. **매일 새벽 05:30(한국시간) 자동 공개**
   - 미리 등록된 날짜 파일은 그날 새벽 **05:30 KST 전까지는 숨겨져 있다가**, **05:30이 되는 순간 성도 화면에서 자동으로 열립니다**.
   - [.github/workflows/daily-publish.yml](.github/workflows/daily-publish.yml)도 매일 05:30 KST (`30 20 * * *` UTC)에 실행되어 `today.json`과 카카오톡 미리보기(제목·이미지)를 갱신합니다.
   - `qt.new-song.org` 연결 후에는 `data/schedule.json`의 `siteUrl`만 새 주소로 바꾸면 됩니다.

---

## 3. 저작권 및 운영 유의사항
- 수록된 성경 본문은 저작재산권이 만료된 **개역한글판(1961)**과 퍼블릭 도메인 **BSB(Berean Standard Bible, CC0)** 내장 데이터를 사용합니다.
- **개역개정판** 본문이나 **매일성경(`sum.su.or.kr`)** 본문·해설 데이터를 그대로 가져와 게시하려면 각각 **대한성서공회**와 **한국성서유니온선교회(`edit02@su.or.kr`)**의 사전 서면 허가가 필요합니다.
