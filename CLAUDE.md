# CLAUDE.md — 가스연료기술센터 대시보드

> Claude Code가 이 저장소를 처음 열 때 반드시 먼저 읽어야 할 문서입니다.
> 추가 맥락은 `@docs/handoff/PROJECT_CONTEXT.md`, `@docs/handoff/CURRENT_STATUS.md` 등을 참조하세요.

---

## 프로젝트 개요

**대체연료본부 가스연료기술센터 사업 현황 대시보드**

- 엑셀 파일(.xlsx/.xls)을 브라우저에서 업로드하면 KPI 카드·도넛 차트·누적 막대 차트·표를 자동으로 렌더링하는 **순수 정적 웹 애플리케이션**입니다.
- 빌드 도구·패키지 관리자·서버가 없습니다. **HTML + JavaScript (Vanilla)** 만 사용하며 모든 외부 라이브러리는 CDN에서 로드합니다.
- 업로드된 파일 데이터는 **브라우저 안에서만** 처리되며 어떤 서버에도 전송되지 않습니다.

---

## 파일 구조 및 진입점

```
Gas-center-dashboard/
├── index.html       # 진입점: UI 구조 + 인라인 CSS + CDN 스크립트 로드
├── dashboard.js     # 진입점: 엑셀 파싱·집계·차트/표 렌더링·내보내기 로직 전부
├── README.md        # 사용자 대상 사용법·스펙 문서
└── docs/
    └── handoff/     # Claude 이관용 인수인계 문서
```

---

## 설치 / 실행 / 빌드 / 테스트 명령

> ⚠️ 이 프로젝트는 `package.json`·`node_modules` 등이 **없습니다.** 아래 명령이 전부입니다.

| 목적 | 명령 / 방법 |
|------|------------|
| **로컬 실행** | `index.html` 을 브라우저에서 직접 열거나, 간단한 정적 서버로 서빙 |
| **정적 서버 예시** | `python3 -m http.server 8080` (저장소 루트에서 실행) |
| **배포** | GitHub Pages: `Settings → Pages → Branch: main / (root) → Save` |
| **빌드** | 없음 (빌드 단계 불필요) |
| **테스트** | 없음 (공식 테스트 인프라 없음) |
| **린트** | 없음 (공식 린터 설정 없음) |

로컬에서 확인하는 가장 빠른 방법:
```bash
cd /path/to/Gas-center-dashboard
python3 -m http.server 8080
# 브라우저에서 http://localhost:8080 접속 후 샘플 엑셀 업로드
```

---

## 기술 스택 (CDN)

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| [SheetJS (xlsx)](https://sheetjs.com/) | 0.18.5 | 엑셀 파싱 |
| [Chart.js](https://www.chartjs.org/) | 4.4.1 | 차트 렌더링 |
| [html2canvas](https://html2canvas.hertzen.com/) | 1.4.1 | 화면 캡처 |
| [jsPDF](https://github.com/parallax/jsPDF) | 2.5.1 | PDF 내보내기 |

---

## 코딩 규칙 (기존 코드에서 추론)

- **언어**: 순수 JavaScript ES6+ (모듈 시스템 없음, `<script src>` 방식)
- **스코프**: `dashboard.js` 전체가 `(function () { "use strict"; ... })();` IIFE로 감싸져 있습니다.
- **전역 상수**: 파일 최상단에 `const TEAMS`, `SHEETS`, `SHEET_COLORS` 등 대문자 상수로 선언합니다.
- **DOM 조작**: `document.getElementById`, `document.querySelector` 직접 사용. 별도 프레임워크 없음.
- **차트 인스턴스**: `let chartCenterShare`, `chartSheetShare`, `chartTeamAmount` 로 관리하고, 파일을 재업로드할 때 `chart.destroy()` 후 재생성합니다.
- **CSS**: `index.html` 내부 `<style>` 블록에 모두 포함. CSS 변수(`--bg`, `--card`, `--accent` 등) 사용.
- **한국어 레이블**: UI 문자열은 모두 한국어. 코드 식별자는 영어(또는 한글 음역).
- **금액 포맷**: `Intl.NumberFormat("ko-KR")` 등을 활용해 천 단위 쉼표 표기.
- **팀 색상**: `--jeonsan: #f59e0b`(주황), `--tanso: #10b981`(초록), `--geo: #3b82f6`(파랑).
- **추가 파일 생성 전**: 가능한 한 기존 두 파일(`index.html`, `dashboard.js`) 내에서 수정하고, 꼭 필요할 때만 새 파일을 추가합니다.

---

## 중요 도메인 지식

- 집계 대상 시트: `국가연구개발사업`, `수탁용역`, `시험인증`
- 옵셔널 시트: `분기별 보고` (목표금액·달성률 계산용)
- 팀 배분: `시험인증` 시트는 **전부 극저온 팀**으로 집계
- 헤더 자동 탐지: 병합 헤더·2단 헤더도 키워드로 자동 인식
- 합계 행 제외: "합계/총계/소계" 키워드가 있는 행은 데이터에서 자동 제외
- 빈값/비숫자("미정", "협약전" 등)는 **0원** 처리

---

## Git 워크플로 및 검증 체크리스트

1. 작업 전 최신 `main` 브랜치 풀: `git pull origin main`
2. 기능 브랜치 생성: `git checkout -b <작업-설명>`
3. 변경 후 브라우저에서 직접 기능 확인 (단위 테스트 없음)
4. 커밋 전 **비밀정보 점검** (아래 참조)
5. PR 생성 후 리뷰 요청

---

## 🔐 보안 — 절대 하지 말 것

- **API 키, 토큰, 비밀번호, 내부 엔드포인트, 개인정보를 코드나 문서에 하드코딩하지 마세요.**
- **실제 업무 엑셀 파일(개인정보·영업비밀 포함 가능)을 저장소에 커밋하지 마세요.**
- 비밀 정보가 없는지 확인 후 커밋하세요. 불확실하면 커밋 전에 사람에게 확인하세요.
- CDN URL을 임의로 변경하거나 버전을 올릴 때 보안 공지를 먼저 확인하세요.

---

## 인수인계 문서 참조

| 문서 | 내용 |
|------|------|
| `@docs/handoff/PROJECT_CONTEXT.md` | 프로젝트 목적·배경·사용자 요구사항 |
| `@docs/handoff/CURRENT_STATUS.md` | 현재 구현 상태·브랜치 현황 |
| `@docs/handoff/DECISIONS.md` | 주요 설계 결정 사항 |
| `@docs/handoff/TODO.md` | 미완료 작업·우선순위 |
| `@docs/handoff/FIRST_PROMPT.md` | Claude에게 바로 붙여넣을 첫 프롬프트 |
