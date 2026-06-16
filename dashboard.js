/* =========================================================================
   미음본부 가스연료기술센터 — 사업 현황 대시보드
   - 엑셀 파일 업로드형 (브라우저에서만 읽음, 저장 안 함)
   - 시트: 국가연구개발사업 / 수탁용역 / 시험인증
   - 금액 지표(실적):
       · 국가연구개발사업 = 당해년도 사업비 합계 (인건비+간접비)
       · 수탁용역        = 총 인정실적(A+B)
       · 시험인증        = 시험수수료(A)  (전부 극저온 팀)
   - 숫자로 변환 불가한 값(미정/협약전/미승금/-/빈칸 등)은 모두 0원 처리
   - 합계 행은 자동 제외 후 재합산
   - 구분(기존/연장/신규/기획) 필터는 국가연구개발사업에만 적용
   ========================================================================= */

(function () {
  "use strict";

  // ---- 팀 정의 ----------------------------------------------------------
  const TEAMS = ["전산", "탄소", "극저온"];
  const TEAM_COLORS = { "전산": "#f59e0b", "탄소": "#10b981", "극저온": "#3b82f6" };
  const TEAM_BADGE = { "전산": "b-jeonsan", "탄소": "b-tanso", "극저온": "b-geo" };

  // ---- 시트(사업 구분) 정의 ---------------------------------------------
  const SHEETS = ["국가연구개발사업", "수탁용역", "시험인증"];
  const SHEET_COLORS = {
    "국가연구개발사업": "#3b82f6",
    "수탁용역": "#f59e0b",
    "시험인증": "#10b981"
  };

  // ---- 상태 -------------------------------------------------------------
  let RAW = { "국가연구개발사업": [], "수탁용역": [], "시험인증": [] };
  let currentGubun = "전체";
  let currentTab = "국가연구개발사업";
  const charts = {};

  // ---- 유틸: 금액 파싱 (변환 불가 = 0) ----------------------------------
  function toNum(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    let s = String(v).trim();
    if (s === "") return 0;
    s = s.replace(/[,\s₩원]/g, "");
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.replace(/[()]/g, ""); }
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return neg ? -n : n;
  }

  // ---- 유틸: 금액 포맷 ---------------------------------------------------
  function fmt(n) {
    return (Math.round(n) || 0).toLocaleString("ko-KR") + "원";
  }
  function fmtShort(n) {
    const v = Math.round(n) || 0;
    if (Math.abs(v) >= 100000000) return (v / 100000000).toFixed(1) + "억";
    if (Math.abs(v) >= 10000) return Math.round(v / 10000).toLocaleString("ko-KR") + "만";
    return v.toLocaleString("ko-KR");
  }

  // ---- 유틸: 텍스트 정규화 (헤더 매칭용) --------------------------------
  function norm(s) {
    return String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase();
  }

  // ---- 헤더 행 자동 탐지 -------------------------------------------------
  function findHeaderRow(rows, keywords) {
    const keys = keywords.map(norm);
    let best = -1, bestScore = 0;
    const scanTo = Math.min(rows.length, 15);
    for (let i = 0; i < scanTo; i++) {
      const cells = (rows[i] || []).map(norm);
      let score = 0;
      keys.forEach(k => { if (cells.some(c => c.includes(k))) score++; });
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return bestScore >= 2 ? best : (best >= 0 ? best : 0);
  }

  // ---- 헤더에서 컬럼 인덱스 찾기 ----------------------------------------
  function colIndex(headerRow, candidates) {
    const cells = headerRow.map(norm);
    for (const cand of candidates) {
      const c = norm(cand);
      const idx = cells.findIndex(cell => cell === c);
      if (idx >= 0) return idx;
    }
    for (const cand of candidates) {
      const c = norm(cand);
      const idx = cells.findIndex(cell => cell && cell.includes(c));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  // ---- 합계 행 판별 -----------------------------------------------------
  function isTotalRow(rowJoined) {
    const s = norm(rowJoined);
    return s.includes("합계") || s.includes("총계") || s.includes("소계") || s === "계";
  }

  // ======================================================================
  //  시트별 파서
  // ======================================================================
  function parseNRND(aoa) {
    const hKeywords = ["순번", "구분", "팀", "과제명", "주관기관", "역할", "당해년도", "사업비", "진행상태"];
    const hRow = findHeaderRow(aoa, hKeywords);
    const header = aoa[hRow] || [];

    const cGubun = colIndex(header, ["구분"]);
    const cTeam = colIndex(header, ["팀"]);
    const cMgmt = colIndex(header, ["관리번호"]);
    const cType = colIndex(header, ["사업형태"]);
    const cTitle = colIndex(header, ["과제명"]);
    const cOrg = colIndex(header, ["주관기관명", "주관기관"]);
    const cRole = colIndex(header, ["역할"]);
    const cState = colIndex(header, ["진행상태"]);

    const sub = aoa[hRow + 1] || [];
    let cAmount = findAmountSumColumn(header, sub, "당해년도", "사업비");

    const out = [];
    for (let r = hRow + 2; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const joined = row.join("");
      if (!joined.trim()) continue;
      if (isTotalRow(joined)) continue;
      const title = cTitle >= 0 ? row[cTitle] : "";
      const team = normTeam(cTeam >= 0 ? row[cTeam] : "");
      if (!String(title || "").trim() && !team) continue;

      out.push({
        구분: String((cGubun >= 0 ? row[cGubun] : "") || "").trim(),
        팀: team,
        관리번호: cMgmt >= 0 ? row[cMgmt] : "",
        사업형태: cType >= 0 ? row[cType] : "",
        과제명: title,
        주관기관명: cOrg >= 0 ? row[cOrg] : "",
        역할: cRole >= 0 ? row[cRole] : "",
        진행상태: cState >= 0 ? row[cState] : "",
        실적: cAmount >= 0 ? toNum(row[cAmount]) : 0,
        _sheet: "국가연구개발사업"
      });
    }
    return out;
  }

  function parseService(aoa) {
    const hKeywords = ["시험", "용역항목", "시험사료명", "담당", "총입금액", "인정실적", "담당팀"];
    const hRow = findHeaderRow(aoa, hKeywords);
    const header = aoa[hRow] || [];
    const sub = aoa[hRow + 1] || [];

    const cItem = colIndex(header, ["시험/용역항목", "시험용역항목", "용역항목"]);
    const cName = colIndex(header, ["시험사료명용역계약명", "용역계약명", "시험사료명"]);
    const cPerson = colIndex(header, ["담당"]);
    const cTeam = colIndex(header, ["담당팀"]);
    const cNote = colIndex(header, ["비고"]);
    let cPerf = colIndex(header, ["총인정실적", "인정실적"]);
    if (cPerf < 0) cPerf = colIndex(sub, ["총인정실적", "인정실적"]);

    const out = [];
    for (let r = hRow + 1; r < aoa.length; r++) {
      if (r === hRow + 1 && looksLikeSubHeader(sub, ["인건비", "간접비", "직접비", "인정실적"])) continue;
      const row = aoa[r] || [];
      const joined = row.join("");
      if (!joined.trim()) continue;
      if (isTotalRow(joined)) continue;
      const name = (cName >= 0 ? row[cName] : "") || (cItem >= 0 ? row[cItem] : "");
      if (!String(name || "").trim()) continue;

      out.push({
        팀: normTeam(cTeam >= 0 ? row[cTeam] : "전산"),
        시험용역항목: cItem >= 0 ? row[cItem] : "",
        과제명: name,
        담당: cPerson >= 0 ? row[cPerson] : "",
        비고: cNote >= 0 ? row[cNote] : "",
        실적: cPerf >= 0 ? toNum(row[cPerf]) : 0,
        _sheet: "수탁용역"
      });
    }
    return out;
  }

  function parseCert(aoa) {
    const hKeywords = ["연번", "업체명", "용역기간", "시험", "담당", "총입금실적", "시험수수료", "재료비"];
    const hRow = findHeaderRow(aoa, hKeywords);
    const header = aoa[hRow] || [];

    const cNo = colIndex(header, ["연번"]);
    const cCompany = colIndex(header, ["업체명"]);
    const cPeriod = colIndex(header, ["용역기간"]);
    const cItem = colIndex(header, ["시험/용역항목", "시험용역항목"]);
    const cName = colIndex(header, ["시험사료명용역계약명", "용역계약명"]);
    const cPerson = colIndex(header, ["담당"]);
    const cNote = colIndex(header, ["비고"]);
    const cFee = colIndex(header, ["시험수수료"]);

    const out = [];
    for (let r = hRow + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const joined = row.join("");
      if (!joined.trim()) continue;
      if (isTotalRow(joined)) continue;
      const company = (cCompany >= 0 ? row[cCompany] : "");
      const name = (cName >= 0 ? row[cName] : "") || (cItem >= 0 ? row[cItem] : "");
      if (!String(company || "").trim() && !String(name || "").trim()) continue;

      out.push({
        팀: "극저온",
        연번: cNo >= 0 ? row[cNo] : "",
        업체명: company,
        용역기간: cPeriod >= 0 ? row[cPeriod] : "",
        과제명: name,
        담당: cPerson >= 0 ? row[cPerson] : "",
        비고: cNote >= 0 ? row[cNote] : "",
        실적: cFee >= 0 ? toNum(row[cFee]) : 0,
        _sheet: "시험인증"
      });
    }
    return out;
  }

  function looksLikeSubHeader(row, keys) {
    const cells = (row || []).map(norm);
    return keys.some(k => cells.some(c => c.includes(norm(k))));
  }

  function findAmountSumColumn(header, sub, blockKw1, blockKw2) {
    const H = header.map(norm);
    const S = sub.map(norm);
    let blockStart = -1, blockEnd = header.length;
    for (let i = 0; i < H.length; i++) {
      if (H[i].includes(norm(blockKw1)) || H[i].includes(norm(blockKw2))) { blockStart = i; break; }
    }
    for (let i = (blockStart >= 0 ? blockStart + 1 : 0); i < H.length; i++) {
      if (H[i].includes("입금") || H[i].includes("실적")) { blockEnd = i; break; }
    }
    for (let i = Math.max(blockStart, 0); i < blockEnd; i++) {
      if (S[i] && S[i].includes("합계")) return i;
    }
    for (let i = Math.max(blockStart, 0); i < blockEnd; i++) {
      if (H[i] && H[i].includes("합계")) return i;
    }
    let lastFee = -1;
    for (let i = Math.max(blockStart, 0); i < blockEnd; i++) {
      if (S[i] && (S[i].includes("인건비") || S[i].includes("간접비"))) lastFee = i;
    }
    if (lastFee >= 0 && lastFee + 1 < blockEnd) return lastFee + 1;
    return -1;
  }

  function normTeam(v) {
    const s = norm(v);
    if (!s) return "";
    if (s.includes("전산")) return "전산";
    if (s.includes("탄소")) return "탄소";
    if (s.includes("극저온") || s.includes("저온")) return "극저온";
    return "";
  }

  // ======================================================================
  //  엑셀 로드
  // ======================================================================
  function handleFile(file) {
    clearError();
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const wanted = ["국가연구개발사업", "수탁용역", "시험인증"];
        const found = {};
        wb.SheetNames.forEach(n => { found[norm(n)] = n; });

        const missing = [];
        wanted.forEach(w => { if (!found[norm(w)]) missing.push(w); });

        function aoaOf(sheetName) {
          const ws = wb.Sheets[sheetName];
          return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
        }

        RAW["국가연구개발사업"] = found[norm("국가연구개발사업")] ? parseNRND(aoaOf(found[norm("국가연구개발사업")])) : [];
        RAW["수탁용역"] = found[norm("수탁용역")] ? parseService(aoaOf(found[norm("수탁용역")])) : [];
        RAW["시험인증"] = found[norm("시험인증")] ? parseCert(aoaOf(found[norm("시험인증")])) : [];

        if (missing.length === wanted.length) {
          showError("필요한 시트를 찾지 못했습니다.\n엑셀에 다음 시트가 있는지 확인해주세요: 국가연구개발사업, 수탁용역, 시험인증\n\n현재 파일의 시트: " + wb.SheetNames.join(", "));
          return;
        }
        if (missing.length) {
          showError("⚠️ 일부 시트를 찾지 못했습니다: " + missing.join(", ") + "\n나머지 시트로 대시보드를 표시합니다.");
        }

        document.getElementById("hint").style.display = "none";
        document.getElementById("dash").style.display = "block";
        document.getElementById("filterBox").style.display = "flex";
        render();
      } catch (err) {
        showError("엑셀 파일을 읽는 중 오류가 발생했습니다.\n" + (err && err.message ? err.message : err));
      }
    };
    reader.onerror = function () { showError("파일을 읽을 수 없습니다."); };
    reader.readAsArrayBuffer(file);
  }

  // ======================================================================
  //  집계 + 렌더
  // ======================================================================
  function getFilteredNRND() {
    if (currentGubun === "전체") return RAW["국가연구개발사업"];
    return RAW["국가연구개발사업"].filter(d => norm(d.구분) === norm(currentGubun));
  }

  function allRowsForAgg() {
    return [].concat(getFilteredNRND(), RAW["수탁용역"], RAW["시험인증"]);
  }

  function aggregate() {
    const rows = allRowsForAgg();
    const amountByTeam = { "전산": 0, "탄소": 0, "극저온": 0 };
    const countByTeam = { "전산": 0, "탄소": 0, "극저온": 0 };
    const amountBySheet = { "국가연구개발사업": 0, "수탁용역": 0, "시험인증": 0 };
    const amountByTeamSheet = {
      "전산": { "국가연구개발사업": 0, "수탁용역": 0, "시험인증": 0 },
      "탄소": { "국가연구개발사업": 0, "수탁용역": 0, "시험인증": 0 },
      "극저온": { "국가연구개발사업": 0, "수탁용역": 0, "시험인증": 0 }
    };
    let total = 0, count = 0;
    rows.forEach(d => {
      const t = d.팀;
      const amt = toNum(d.실적);
      total += amt; count++;
      if (amountBySheet[d._sheet] !== undefined) amountBySheet[d._sheet] += amt;
      if (TEAMS.includes(t)) {
        amountByTeam[t] += amt;
        countByTeam[t] += 1;
        const sh = d._sheet;
        if (amountByTeamSheet[t][sh] !== undefined) amountByTeamSheet[t][sh] += amt;
      }
    });
    return { amountByTeam, countByTeam, amountBySheet, amountByTeamSheet, total, count };
  }

  function render() {
    const agg = aggregate();

    // 센터 전체 실적 KPI: 총액 + 국가/수탁/시험 합계 내역
    setText("kpiCenter", fmtShort(agg.total) + "원");
    const cHost = document.getElementById("kpiCenterSub");
    if (cHost) {
      cHost.innerHTML =
        '<div class="kpi-bd"><span>국가연구개발사업</span><b>' + fmt(agg.amountBySheet["국가연구개발사업"]) + '</b></div>' +
        '<div class="kpi-bd"><span>수탁용역</span><b>' + fmt(agg.amountBySheet["수탁용역"]) + '</b></div>' +
        '<div class="kpi-bd"><span>시험인증</span><b>' + fmt(agg.amountBySheet["시험인증"]) + '</b></div>';
    }

    renderTeamKpi("Jeonsan", "전산", agg);
    renderTeamKpi("Tanso", "탄소", agg);
    renderTeamKpi("Geo", "극저온", agg);

    drawCenterShare(agg);
    drawTeamAmount(agg);

    renderTable(currentTab);
  }

  // 팀 KPI 카드: 총액 + 국가/수탁/시험 항목별 금액
  function renderTeamKpi(suffix, team, agg) {
    setText("kpi" + suffix, fmtShort(agg.amountByTeam[team]) + "원");
    const bd = agg.amountByTeamSheet[team];
    const host = document.getElementById("kpi" + suffix + "Sub");
    if (!host) return;
    host.innerHTML =
      '<div class="kpi-bd"><span>국가연구개발사업</span><b>' + fmt(bd["국가연구개발사업"]) + '</b></div>' +
      '<div class="kpi-bd"><span>수탁용역</span><b>' + fmt(bd["수탁용역"]) + '</b></div>' +
      '<div class="kpi-bd"><span>시험인증</span><b>' + fmt(bd["시험인증"]) + '</b></div>';
  }

  function drawCenterShare(agg) {
    const vals = TEAMS.map(t => Math.round(ag
