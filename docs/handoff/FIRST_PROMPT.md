# FIRST_PROMPT.md — Claude 첫 프롬프트 (복사·붙여넣기용)

아래 텍스트를 Claude Code에 **그대로 붙여넣어** 시작하세요.

---

```
안녕하세요, Claude. Gas-center-dashboard 저장소를 인수받아 작업을 이어가겠습니다.

먼저 다음 순서로 저장소를 파악해 주세요:

1. `CLAUDE.md` 를 읽고 프로젝트 개요·명령·규칙을 숙지하세요.
2. `docs/handoff/PROJECT_CONTEXT.md`, `CURRENT_STATUS.md`, `DECISIONS.md`, `TODO.md` 를 순서대로 읽어 맥락을 파악하세요.
3. `index.html` 과 `dashboard.js` 의 핵심 구조를 훑어보세요.
4. `git log --oneline -20` 과 `git branch -a` 로 커밋 이력 및 브랜치 현황을 확인하세요.
   - 특히 `doo-mo-redesigned-spork` 브랜치가 존재하는지, 또는 이미 병합되었는지 확인해 주세요.
5. `CLAUDE.md` 와 `CURRENT_STATUS.md` 에 기록된 가정이 실제 코드와 일치하는지 검증하고, 불일치 사항이 있으면 알려 주세요.

파악이 끝나면:
- 현재 상태에 대한 간단한 요약
- `TODO.md` 의 항목 중 가장 먼저 작업할 것 제안
- 작업 시작 전 확인이 필요한 사항

을 정리해서 알려 주세요. 코드 수정은 그 다음에 진행합니다.
```

---

> ⚠️ 비밀정보(API 키, 사내 엑셀 파일 경로, 개인정보 등)는 절대 Claude 프롬프트에 포함하지 마세요.
