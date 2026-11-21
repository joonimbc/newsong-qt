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

## 2. 주간 준비 & 매일 자동 배포 흐름

1. **주 1회(예: 토요일) 말씀 준비 — 장절만 넣으면 본문 자동 입력**
   ```bash
   ruby scripts/new_day.rb --date 2026-11-22 --ref "시편 22:22-31" --title "다 함께 부를 노래"
   ```
   - `data/days/2026-11-22.json` 이 만들어지고 **개역한글·BSB 본문이 자동으로 채워집니다** (`scripts/bible/` 원본 데이터 사용).
   - 파일 안의 `TODO`(질문·적용 등)를 [scripts/coffeebreak_prompt.md](scripts/coffeebreak_prompt.md)를 참고해 채우고 목회자가 검수합니다.
   - `TODO`가 남은 파일은 자동으로 공개 목록에서 빠지므로 미완성 본문이 노출되지 않습니다.
2. **가드레일 검증 (배포 전 사전 확인)**
   ```bash
   ruby scripts/publish_daily.rb --dry-run
   ```
   - 손으로 입력한 본문에 오타가 있으면 개역한글·BSB 원문으로 자동 교정하고 알려 줍니다.
3. **매일 새벽 05:30(한국시간) 자동 공개**
   - 미리 올려 둔 날짜 본문은 **성도의 화면이 한국시간 05:30이 되는 순간 스스로 다음 본문으로 바뀝니다** (GitHub 예약 실행 지연과 무관).
   - [.github/workflows/daily-publish.yml](.github/workflows/daily-publish.yml)은 매일 05:30 KST (`30 20 * * *` UTC)에 실행되어 `today.json`과 카카오톡 미리보기(제목·이미지)를 갱신합니다.
   - 나눔 복사 문구에는 `https://…/?d=YYYY-MM-DD` 링크가 자동으로 붙습니다.
   - `qt.new-song.org` 연결 후에는 `data/schedule.json`의 `siteUrl`만 새 주소로 바꾸면 됩니다.

---

## 3. 저작권 및 운영 유의사항
- 현재 수록된 본문(시편 21:1–13, 시편 22:1–12)은 저작재산권이 만료된 **개역한글판**과 퍼블릭 도메인 **BSB(Berean Standard Bible, CC0)**를 사용했습니다.
- **개역개정판** 본문이나 **매일성경(`sum.su.or.kr`)** 본문·해설 데이터를 그대로 가져와 게시하려면 각각 **대한성서공회**와 **한국성서유니온선교회(`edit02@su.or.kr`)**의 사전 서면 허가가 필요합니다.
