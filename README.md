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

1. **주 1회(예: 토요일) 말씀 준비 (15분)**
   - [scripts/coffeebreak_prompt.md](scripts/coffeebreak_prompt.md)의 프롬프트를 참고해 다음 주 7일 치 JSON 초안을 만듭니다.
   - 목회자/리더가 문맥과 질문을 검수한 뒤 `data/days/YYYY-MM-DD.json` 파일들로 저장합니다.
2. **가드레일 검증 (배포 전 사전 확인)**
   ```bash
   ruby scripts/publish_daily.rb --date 2026-11-21 --dry-run
   ```
3. **매일 새벽 정시 자동 배포**
   - [.github/workflows/daily-publish.yml](.github/workflows/daily-publish.yml)이 매일 새벽기도 시각인 **05:30 KST (`30 20 * * *` UTC)**에 `ruby scripts/publish_daily.rb --fallback-latest`를 실행해 `data/today.json`, `data/schedule.json`, `data/fallback-data.js`, `index.html`의 카카오톡 미리보기(OG 태그)를 자동 갱신하고 배포합니다.
   - 성도들에게는 매일 아침 카톡방에 고정 주소 뒤에 날짜 파라미터만 붙인 링크(`https://qt.new-song.org/?d=2026-11-21`)를 공유하면 카톡 미리보기 캐시 없이 새 본문이 깔끔하게 뜹니다.

---

## 3. 저작권 및 운영 유의사항
- 현재 수록된 본문(시편 21:1–13, 시편 22:1–12)은 저작재산권이 만료된 **개역한글판**과 퍼블릭 도메인 **BSB(Berean Standard Bible, CC0)**를 사용했습니다.
- **개역개정판** 본문이나 **매일성경(`sum.su.or.kr`)** 본문·해설 데이터를 그대로 가져와 게시하려면 각각 **대한성서공회**와 **한국성서유니온선교회(`edit02@su.or.kr`)**의 사전 서면 허가가 필요합니다.
