/* =========================================================================
   대체연료본부 가스연료기술센터 — 사업 현황 대시보드
   ========================================================================= */
(function () {
  "use strict";

  const TEAMS = ["전산", "탄소", "극저온"];
  const TEAM_COLORS = { "전산": "#f59e0b", "탄소": "#10b981", "극저온": "#3b82f6" };
  const TEAM_BADGE = { "전산": "b-jeonsan", "탄소": "b-tanso", "극저온": "b-geo" };

  const SHEETS = ["국가연구개발사업", "수탁용역", "시험인증"];
  // 팀 도넛(주황/초록/파랑)과 구분되는 색: 인디고 / 로즈 / 틸
  const SHEET_COLORS = { "국가연구개발사업": "#6366f1", "수탁용역": "#ec4899", "시험인증": "#14b8a6" };
  // 시트별 헤더 행 탐지 키워드 (실적 확인 · 변경사항 확인 공용)
  const HEADER_KEYWORDS = {
    "국가연구개발사업": ["순번", "구분", "팀", "과제명", "주관기관", "역할", "당해년도", "사업비", "진행상태"],
    "수탁용역": ["시험", "용역항목", "시험사료명", "담당", "총입금액", "인정실적", "담당팀"],
    "시험인증": ["연번", "업체명", "용역기간", "시험", "담당", "총입금실적", "시험수수료", "재료비"]
  };

  let RAW = { "국가연구개발사업": [], "수탁용역": [], "시험인증": [] };
  let GOAL = 0; // 운용자금 목표금액 ('분기별 보고' 시트에서 자동 탐지). 못 찾으면 0
  let currentTab = "국가연구개발사업";
  const charts = {};
  // 표 검색·팀 필터·정렬 상태
  let tableQuery = "";
  let tableTeam = "";   // "" | "전산" | "탄소" | "극저온" | "미지정"
  let sortKey = null;
  let sortDir = 1;      // 1: 오름차순, -1: 내림차순

  function toNum(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    let s = String(v).trim();
    if (s === "") return 0;
    s = s.replace(/[,\s₩원%]/g, "");
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.replace(/[()]/g, ""); }
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return neg ? -n : n;
  }

  function fmt(n) { return (Math.round(n) || 0).toLocaleString("ko-KR") + "원"; }
  function fmtShort(n) {
    const v = Math.round(n) || 0;
    if (Math.abs(v) >= 100000000) return (v / 100000000).toFixed(1) + "억";
    if (Math.abs(v) >= 10000) return Math.round(v / 10000).toLocaleString("ko-KR") + "만";
    return v.toLocaleString("ko-KR");
  }

  function norm(s) { return String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase(); }

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

  // 칸 하나의 내용 전체가 합계류 단어("합계", "합 계", "총계", "소계(A+B)" 등)일 때만 합계 행으로 봄.
  // 과제명·비고에 "통합계측", "총계약금액"처럼 글자가 섞인 행은 데이터로 유지.
  function isTotalRow(row) {
    return row.some(c => /^(총?합계|총계|소계|누계|계)(\(.*\))?$/.test(norm(c)));
  }

  // '분기별 보고' 시트에서 "운용자금 목표금액" 글자를 찾아 그 아래 칸의 숫자를 목표로 읽음
  function parseGoal(aoa) {
    if (!aoa || !aoa.length) return 0;
    const KEY = norm("운용자금목표금액");
    for (let r = 0; r < aoa.length; r++) {
      const row = aoa[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cell = norm(row[c]);
        if (cell && (cell.includes(KEY) || (cell.includes("운용자금") && cell.includes("목표")))) {
          for (let dr = 1; dr <= 3; dr++) {
            const below = aoa[r + dr] || [];
            for (const cc of [c, c + 1, c - 1]) {
              if (cc < 0) continue;
              const val = toNum(below[cc]);
              if (val > 0) return val;
            }
          }
          for (let cc = c + 1; cc < row.length; cc++) {
            const val = toNum(row[cc]);
            if (val > 0) return val;
          }
        }
      }
    }
    return 0;
  }

  function parseNRND(aoa) {
    const hKeywords = HEADER_KEYWORDS["국가연구개발사업"];
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
      if (isTotalRow(row)) continue;
      const title = cTitle >= 0 ? row[cTitle] : "";
      const teamRaw = cTeam >= 0 ? row[cTeam] : "";
      const team = normTeam(teamRaw);
      if (!String(title || "").trim() && !team) continue;
      out.push({
        구분: String((cGubun >= 0 ? row[cGubun] : "") || "").trim(),
        팀: team,
        _teamRaw: String(teamRaw || "").trim(),
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
    const hKeywords = HEADER_KEYWORDS["수탁용역"];
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
      if (isTotalRow(row)) continue;
      const name = (cName >= 0 ? row[cName] : "") || (cItem >= 0 ? row[cItem] : "");
      if (!String(name || "").trim()) continue;
      const teamRaw = cTeam >= 0 ? row[cTeam] : "전산";
      out.push({
        팀: normTeam(teamRaw),
        _teamRaw: String(teamRaw || "").trim(),
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
    const hKeywords = HEADER_KEYWORDS["시험인증"];
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
      if (isTotalRow(row)) continue;
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

        // '분기별 보고' 시트에서 운용자금 목표금액 자동 탐지 (없으면 0 → 숨김)
        GOAL = 0;
        const goalSheet = found[norm("분기별보고")] || found[norm("분기별 보고")];
        if (goalSheet) GOAL = parseGoal(aoaOf(goalSheet));

        if (missing.length === wanted.length) {
          showError("필요한 시트를 찾지 못했습니다.\n엑셀에 다음 시트가 있는지 확인해주세요: 국가연구개발사업, 수탁용역, 시험인증\n\n현재 파일의 시트: " + wb.SheetNames.join(", "));
          return;
        }
        if (missing.length) {
          showError("⚠️ 일부 시트를 찾지 못했습니다: " + missing.join(", ") + "\n나머지 시트로 대시보드를 표시합니다.");
        }
        showTeamNotice();
        document.getElementById("hint").style.display = "none";
        document.getElementById("dash").style.display = "block";
        document.getElementById("exportBox").style.display = "flex";
        render();
      } catch (err) {
        showError("엑셀 파일을 읽는 중 오류가 발생했습니다.\n" + (err && err.message ? err.message : err));
      }
    };
    reader.onerror = function () { showError("파일을 읽을 수 없습니다."); };
    reader.readAsArrayBuffer(file);
  }

  function allRowsForAgg() {
    return [].concat(RAW["국가연구개발사업"], RAW["수탁용역"], RAW["시험인증"]);
  }

  // 팀이 전산/탄소/극저온이 아닌 행(빈칸, "-", "공통" 등) 안내.
  // 이런 행은 센터 전체 실적에는 들어가지만 팀별 실적에는 빠지므로, 숫자가 안 맞는 이유를 알려줌.
  function showTeamNotice() {
    const rows = allRowsForAgg().filter(d => !TEAMS.includes(d.팀));
    if (!rows.length) return;
    const sum = rows.reduce((a, d) => a + toNum(d.실적), 0);
    const MAX = 10;
    let msg = "⚠️ 팀이 지정되지 않은 행이 " + rows.length + "건 있습니다 (금액 합 " + fmt(sum) + ").\n" +
      "센터 전체 실적에는 포함되지만 팀별 실적·팀 비율 차트에는 빠집니다. 엑셀의 팀(담당팀) 칸을 확인해주세요.";
    rows.slice(0, MAX).forEach(d => {
      const name = String(d.과제명 || "").trim();
      msg += "\n · " + d._sheet + " | " + (name.length > 30 ? name.slice(0, 30) + "…" : name) +
        " | " + fmt(toNum(d.실적)) + (d._teamRaw ? " | 팀 칸: " + d._teamRaw : " | 팀 칸: (빈칸)");
    });
    if (rows.length > MAX) msg += "\n · 외 " + (rows.length - MAX) + "건";
    document.getElementById("errBox").insertAdjacentHTML("beforeend", '<div class="notice">' + escapeHtml(msg) + "</div>");
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
    setText("kpiCenter", fmtShort(agg.total) + "원");
    setText("kpiCenterCnt", agg.count + "건");
    const cHost = document.getElementById("kpiCenterSub");
    if (cHost) {
      let h =
        '<div class="kpi-bd"><span>국가연구개발사업</span><b>' + fmt(agg.amountBySheet["국가연구개발사업"]) + '</b></div>' +
        '<div class="kpi-bd"><span>수탁용역</span><b>' + fmt(agg.amountBySheet["수탁용역"]) + '</b></div>' +
        '<div class="kpi-bd"><span>시험인증</span><b>' + fmt(agg.amountBySheet["시험인증"]) + '</b></div>';
      if (GOAL > 0) {
        const rate = (agg.total / GOAL) * 100;
        h += '<div class="kpi-goal"><span>목표금액</span><b>' + fmt(GOAL) + '</b></div>' +
             '<div class="kpi-goal"><span>달성률</span><b>' + rate.toFixed(1) + '%</b></div>';
      }
      cHost.innerHTML = h;
    }
    renderTeamKpi("Jeonsan", "전산", agg);
    renderTeamKpi("Tanso", "탄소", agg);
    renderTeamKpi("Geo", "극저온", agg);
    drawCenterShare(agg);
    drawSheetShare(agg);
    drawTeamAmount(agg);
    renderTable(currentTab);
  }

  function renderTeamKpi(suffix, team, agg) {
    setText("kpi" + suffix, fmtShort(agg.amountByTeam[team]) + "원");
    setText("kpi" + suffix + "Cnt", agg.countByTeam[team] + "건");
    const bd = agg.amountByTeamSheet[team];
    const host = document.getElementById("kpi" + suffix + "Sub");
    if (!host) return;
    const teamSum = bd["국가연구개발사업"] + bd["수탁용역"] + bd["시험인증"];
    host.innerHTML =
      '<div class="kpi-bd"><span>국가연구개발사업</span><b>' + fmt(bd["국가연구개발사업"]) + '</b></div>' +
      '<div class="kpi-bd"><span>수탁용역</span><b>' + fmt(bd["수탁용역"]) + '</b></div>' +
      '<div class="kpi-bd"><span>시험인증</span><b>' + fmt(bd["시험인증"]) + '</b></div>' +
      '<div class="kpi-goal"><span>합계</span><b>' + fmt(teamSum) + '</b></div>';
  }

  // 도넛 가운데에 텍스트를 그리는 플러그인
  const centerTextPlugin = {
    id: "centerText",
    afterDraw(chart) {
      const opt = chart.options.plugins.centerText;
      if (!opt || !opt.lines || !opt.lines.length) return;
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = opt.lines;
      let offsetY = -(lines.length - 1) * 11;
      lines.forEach(ln => {
        ctx.fillStyle = ln.color || "#1f2937";
        ctx.font = ln.font || "13px 'Malgun Gothic', sans-serif";
        ctx.fillText(ln.text, cx, cy + offsetY);
        offsetY += (ln.lineHeight || 22);
      });
      ctx.restore();
    }
  };

  // 1) 팀 비율 도넛 (가운데: 목표 달성률 또는 센터 합계)
  function drawCenterShare(agg) {
    const vals = TEAMS.map(t => Math.round(agg.amountByTeam[t]));
    const sum = vals.reduce((a, b) => a + b, 0);

    let centerLines;
    if (GOAL > 0) {
      const rate = (agg.total / GOAL) * 100;
      centerLines = [
        { text: "목표 달성률", color: "#6b7280", font: "12px 'Malgun Gothic', sans-serif", lineHeight: 22 },
        { text: rate.toFixed(1) + "%", color: "#2563eb", font: "800 26px 'Malgun Gothic', sans-serif", lineHeight: 24 },
        { text: fmtShort(agg.total) + " / " + fmtShort(GOAL), color: "#9ca3af", font: "11px 'Malgun Gothic', sans-serif", lineHeight: 18 }
      ];
    } else {
      centerLines = [
        { text: "센터 합계", color: "#6b7280", font: "12px 'Malgun Gothic', sans-serif", lineHeight: 22 },
        { text: fmtShort(sum) + "원", color: "#1f2937", font: "800 22px 'Malgun Gothic', sans-serif", lineHeight: 22 }
      ];
    }

    upsertChart("chartCenterShare", "doughnut", {
      labels: TEAMS.map(t => t + "팀"),
      datasets: [{
        data: vals,
        backgroundColor: TEAMS.map(t => TEAM_COLORS[t]),
        borderWidth: 2, borderColor: "#fff"
      }]
    }, {
      cutout: "62%",
      plugins: {
        legend: { position: "bottom" },
        centerText: { lines: centerLines },
        tooltip: { callbacks: { label: c => {
          const pct = sum > 0 ? ((c.parsed / sum) * 100).toFixed(1) : "0.0";
          return c.label + ": " + fmt(c.parsed) + " (" + pct + "%)";
        } } }
      }
    }, [centerTextPlugin]);
  }

  // 2) 사업 항목 비율 도넛 (국가/수탁/시험)
  function drawSheetShare(agg) {
    const vals = SHEETS.map(sh => Math.round(agg.amountBySheet[sh]));
    const sum = vals.reduce((a, b) => a + b, 0);

    const centerLines = [
      { text: "센터 합계", color: "#6b7280", font: "12px 'Malgun Gothic', sans-serif", lineHeight: 22 },
      { text: fmtShort(sum) + "원", color: "#1f2937", font: "800 22px 'Malgun Gothic', sans-serif", lineHeight: 22 }
    ];

    upsertChart("chartSheetShare", "doughnut", {
      labels: SHEETS,
      datasets: [{
        data: vals,
        backgroundColor: SHEETS.map(sh => SHEET_COLORS[sh]),
        borderWidth: 2, borderColor: "#fff"
      }]
    }, {
      cutout: "62%",
      plugins: {
        legend: { position: "bottom" },
        centerText: { lines: centerLines },
        tooltip: { callbacks: { label: c => {
          const pct = sum > 0 ? ((c.parsed / sum) * 100).toFixed(1) : "0.0";
          return c.label + ": " + fmt(c.parsed) + " (" + pct + "%)";
        } } }
      }
    }, [centerTextPlugin]);
  }

  // 3) 팀별 실적 누적 막대 (가로축 라벨: ~팀)
  function drawTeamAmount(agg) {
    const datasets = SHEETS.map(sh => ({
      label: sh,
      data: TEAMS.map(t => Math.round(agg.amountByTeamSheet[t][sh])),
      backgroundColor: SHEET_COLORS[sh],
      borderWidth: 1,
      borderColor: "#fff",
      stack: "amount"
    }));
    upsertChart("chartTeamAmount", "bar", {
      labels: TEAMS.map(t => t + "팀"),
      datasets: datasets
    }, {
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            label: c => {
              const t = TEAMS[c.dataIndex];
              const teamTotal = agg.amountByTeam[t] || 0;
              const v = c.parsed.y || 0;
              const pct = teamTotal > 0 ? ((v / teamTotal) * 100).toFixed(1) : "0.0";
              return c.dataset.label + ": " + fmt(v) + " (" + pct + "%)";
            },
            footer: items => {
              const teamIdx = items.length ? items[0].dataIndex : -1;
              if (teamIdx < 0) return "";
              const t = TEAMS[teamIdx];
              return "팀 합계: " + fmt(agg.amountByTeam[t]);
            }
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { callback: v => fmtShort(v) } }
      }
    });
  }

  // 표 컬럼 정의
  //  align: "num"(오른쪽,금액) | "left"(왼쪽,긴텍스트) | "center"(가운데,기본)
  //  w: 열 너비(px). 미지정 시 자동
  //  ellip: true 면 한 줄 말줄임
  const TABLE_COLS = {
    "국가연구개발사업": [
      { k: "구분", h: "구분", align: "center", w: 56 },
      { k: "팀", h: "팀", team: true, align: "center", w: 64 },
      { k: "관리번호", h: "관리번호", align: "center", w: 88 },
      { k: "과제명", h: "과제명", align: "left", ellip: true },
      { k: "주관기관명", h: "주관기관명", align: "left", ellip: true, w: 150 },
      { k: "역할", h: "역할", align: "center", w: 60 },
      { k: "진행상태", h: "진행상태", align: "center", w: 78 },
      { k: "실적", h: '<span class="th-sub">(인건비+간접비)</span><br>당해년도 사업비 합계', num: true, w: 128 }
    ],
    "수탁용역": [
      { k: "팀", h: "담당팀", team: true, align: "center", w: 64 },
      { k: "시험용역항목", h: "시험/용역항목", align: "center", w: 110 },
      { k: "과제명", h: "시험·용역 계약명", align: "left", ellip: true },
      { k: "담당", h: "담당", align: "center", w: 72 },
      { k: "실적", h: "총 인정실적(A+B)", num: true, w: 128 },
      { k: "비고", h: "비고", align: "center", w: 100 }
    ],
    "시험인증": [
      { k: "팀", h: "팀", team: true, align: "center", w: 64 },
      { k: "연번", h: "연번", align: "center", w: 50 },
      { k: "업체명", h: "업체명", align: "left", ellip: true, w: 120 },
      { k: "용역기간", h: "용역기간", align: "center", w: 104 },
      { k: "과제명", h: "시험/용역항목", align: "left", ellip: true },
      { k: "담당", h: "담당", align: "center", w: 72 },
      { k: "실적", h: "시험수수료(A)", num: true, w: 118 },
      { k: "비고", h: "비고", align: "center", w: 92 }
    ]
  };

  function alignClass(c) {
    if (c.num) return "num";
    if (c.align === "left") return "left";
    if (c.align === "center") return "center";
    return "center";
  }

  // 표에 보일 행: 팀 필터 → 검색어 → 정렬 순서로 적용
  function tableRows(sheet, cols) {
    const q = norm(tableQuery);
    const rows = (RAW[sheet] || []).filter(d => {
      if (tableTeam && (TEAMS.includes(d.팀) ? d.팀 : "미지정") !== tableTeam) return false;
      if (q && !norm(cols.map(c => d[c.k]).join(" ")).includes(q)) return false;
      return true;
    });
    const col = cols.find(c => c.k === sortKey);
    if (col) {
      rows.sort((a, b) => col.num
        ? (toNum(a[col.k]) - toNum(b[col.k])) * sortDir
        : String(a[col.k] == null ? "" : a[col.k]).localeCompare(String(b[col.k] == null ? "" : b[col.k]), "ko", { numeric: true }) * sortDir);
    }
    return rows;
  }

  function renderTable(sheet) {
    const cols = TABLE_COLS[sheet];
    const data = tableRows(sheet, cols);
    // 좁은 화면에서도 말줄임 열(과제명 등)이 0px로 사라지지 않도록 표 최소 너비 지정 → 넘치면 가로 스크롤
    const minW = cols.reduce((s, c) => s + (c.w || 220), 0);

    let html = '<table style="min-width:' + minW + 'px;"><colgroup>';
    cols.forEach(c => { html += c.w ? ('<col style="width:' + c.w + 'px;">') : "<col>"; });
    html += "</colgroup><thead><tr>";
    cols.forEach(c => {
      const arrow = sortKey === c.k ? (sortDir > 0 ? " ▲" : " ▼") : "";
      html += '<th class="' + alignClass(c) + '" data-k="' + c.k + '" title="눌러서 정렬">' + c.h + arrow + "</th>";
    });
    html += "</tr></thead><tbody>";

    if (!data.length) {
      const msg = (RAW[sheet] || []).length ? "조건에 맞는 항목이 없습니다." : "표시할 데이터가 없습니다.";
      html += '<tr><td colspan="' + cols.length + '" style="text-align:center;color:#9ca3af;padding:24px;">' + msg + "</td></tr>";
    } else {
      const sumVal = data.reduce((acc, d) => acc + toNum(d.실적), 0);
      const numColIdx = cols.findIndex(c => c.num);
      html += '<tr class="total-row">';
      cols.forEach((c, idx) => {
        if (c.num) {
          html += '<td class="num">' + fmt(sumVal) + "</td>";
        } else if (idx === 0) {
          html += '<td class="center" style="white-space:nowrap;">총 ' + data.length + '건</td>';
        } else if (idx === numColIdx - 1) {
          html += '<td class="center" style="white-space:nowrap;">총계</td>';
        } else {
          html += '<td class="center"></td>';
        }
      });
      html += "</tr>";

      data.forEach(d => {
        html += "<tr>";
        cols.forEach(c => {
          let val = d[c.k];
          const ac = alignClass(c) + (c.ellip ? " ellip" : "");
          if (c.num) {
            html += '<td class="num">' + fmt(toNum(val)) + "</td>";
          } else if (c.team) {
            const t = normTeam(val);
            const badge = TEAM_BADGE[t] || "b-etc";
            html += '<td class="' + ac + '"><span class="badge ' + badge + '">' + (t || (val || "-")) + "</span></td>";
          } else {
            const s = (val === null || val === undefined || String(val).trim() === "") ? "-" : String(val);
            const title = c.ellip ? (' title="' + escapeHtml(s) + '"') : "";
            html += '<td class="' + ac + '"' + title + ">" + escapeHtml(s) + "</td>";
          }
        });
        html += "</tr>";
      });
    }
    html += "</tbody></table>";
    const scrollBox = document.getElementById("tableScroll");
    scrollBox.innerHTML = html;
    // 헤더가 두 줄이 되면 높이가 바뀌므로, 합계 행 고정 위치를 실제 헤더 높이에 맞춤
    const th = scrollBox.querySelector("thead th");
    if (th && th.offsetHeight) scrollBox.style.setProperty("--thead-h", th.offsetHeight + "px");
  }

  function upsertChart(canvasId, type, data, options, plugins) {
    if (charts[canvasId]) charts[canvasId].destroy();
    const ctx = document.getElementById(canvasId).getContext("2d");
    const cfg = {
      type, data,
      options: Object.assign({ responsive: true, maintainAspectRatio: false }, options)
    };
    if (plugins && plugins.length) cfg.plugins = plugins;
    charts[canvasId] = new Chart(ctx, cfg);
  }
  function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  function showError(msg) { document.getElementById("errBox").innerHTML = '<div class="err">' + escapeHtml(msg) + "</div>"; }
  function clearError() { document.getElementById("errBox").innerHTML = ""; }

  // 캡처/PDF용: 표 위쪽(captureArea)만 캔버스로 렌더
  function captureDash() {
    const area = document.getElementById("captureArea");
    return html2canvas(area, { scale: 2, backgroundColor: "#f4f6fa", useCORS: true });
  }
  function todayStr() {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }
  function setBusy(busy) {
    ["btnCapture", "btnPdf"].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.disabled = busy;
    });
  }

  function exportImage() {
    setBusy(true);
    captureDash().then(canvas => {
      const link = document.createElement("a");
      link.download = "가스연료기술센터_대시보드_" + todayStr() + ".png";
      link.href = canvas.toDataURL("image/png");
      link.click();
      setBusy(false);
    }).catch(err => {
      showError("화면 캡처 중 오류가 발생했습니다.\n" + (err && err.message ? err.message : err));
      setBusy(false);
    });
  }

  function exportPdf() {
    setBusy(true);
    captureDash().then(canvas => {
      const imgData = canvas.toDataURL("image/png");
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const usableW = pageW - margin * 2;
      const imgH = (canvas.height * usableW) / canvas.width;

      if (imgH <= pageH - margin * 2) {
        pdf.addImage(imgData, "PNG", margin, margin, usableW, imgH);
      } else {
        let remainingH = imgH;
        let position = margin;
        const pageContentH = pageH - margin * 2;
        while (remainingH > 0) {
          pdf.addImage(imgData, "PNG", margin, position, usableW, imgH);
          remainingH -= pageContentH;
          if (remainingH > 0) {
            pdf.addPage();
            position = margin - (imgH - remainingH);
          }
        }
      }
      pdf.save("가스연료기술센터_대시보드_" + todayStr() + ".pdf");
      setBusy(false);
    }).catch(err => {
      showError("PDF 내보내기 중 오류가 발생했습니다.\n" + (err && err.message ? err.message : err));
      setBusy(false);
    });
  }

  const fileInput = document.getElementById("fileInput");
  const dropZone = document.getElementById("dropZone");
  const fileName = document.getElementById("fileName");
  let dragDepth = 0;

  function hasDraggedFiles(e) {
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"));
  }

  function loadDashboardFile(file) {
    clearError();
    if (!file || !/\.(xlsx|xls)$/i.test(file.name)) {
      showError("엑셀 파일(.xlsx 또는 .xls)만 업로드할 수 있습니다.");
      return;
    }
    fileName.textContent = file.name;
    handleFile(file);
  }

  function loadFileList(files) {
    const selected = Array.from(files || []);
    clearError();
    if (!selected.length) return;
    if (selected.length > 1) {
      showError("엑셀 파일은 한 번에 하나만 업로드할 수 있습니다.");
      return;
    }
    loadDashboardFile(selected[0]);
  }

  fileInput.addEventListener("change", function (e) {
    loadFileList(e.target.files);
    e.target.value = "";
  });

  dropZone.addEventListener("dragenter", function (e) {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dropZone.classList.add("is-dragover");
  });

  dropZone.addEventListener("dragover", function (e) {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  dropZone.addEventListener("dragleave", function (e) {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.classList.remove("is-dragover");
  });

  dropZone.addEventListener("drop", function (e) {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove("is-dragover");
    loadFileList(e.dataTransfer.files);
  });

  ["dragover", "drop"].forEach(eventName => {
    document.addEventListener(eventName, function (e) {
      if (hasDraggedFiles(e)) e.preventDefault();
    });
  });

  document.getElementById("btnCapture").addEventListener("click", exportImage);
  document.getElementById("btnPdf").addEventListener("click", exportPdf);

  document.getElementById("tableTabs").addEventListener("click", function (e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    currentTab = btn.getAttribute("data-sheet");
    sortKey = null; // 탭마다 열이 달라서 정렬은 초기화 (검색어·팀 필터는 유지)
    document.querySelectorAll("#tableTabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderTable(currentTab);
  });

  document.getElementById("tableSearch").addEventListener("input", function (e) {
    tableQuery = e.target.value;
    renderTable(currentTab);
  });

  document.getElementById("teamFilter").addEventListener("change", function (e) {
    tableTeam = e.target.value;
    renderTable(currentTab);
  });

  // 헤더 클릭 정렬: 같은 열을 다시 누르면 방향 전환. 금액 열은 큰 금액부터.
  document.getElementById("tableScroll").addEventListener("click", function (e) {
    const th = e.target.closest("thead th[data-k]");
    if (!th) return;
    const k = th.getAttribute("data-k");
    if (sortKey === k) {
      sortDir = -sortDir;
    } else {
      sortKey = k;
      const col = TABLE_COLS[currentTab].find(c => c.k === k);
      sortDir = col && col.num ? -1 : 1;
    }
    renderTable(currentTab);
  });

  /* =========================================================================
     변경사항 확인: 공유한 원본 ↔ 팀 회신본 비교 (브라우저 안에서만 처리)
     ========================================================================= */
  // 시트별 설정: name = 행을 맞출 때 가장 중요하게 보는 열(과제명·계약명), team = 팀 열
  const DIFF_SHEETS = [
    { sheet: "국가연구개발사업", name: ["과제명"], team: ["팀"] },
    { sheet: "수탁용역", name: ["시험시료명용역계약명", "시험사료명용역계약명", "용역계약명", "시험사료명"], team: ["담당팀"] },
    { sheet: "시험인증", name: ["시험시료명용역계약명", "시험사료명용역계약명", "용역계약명"], fixedTeam: "극저온" }
  ];
  const MATCH_MIN = 0.55; // 이 이상 비슷하면 같은 행(수정)으로 봄
  const MOVE_MIN = 0.8;   // 순서가 바뀐 행은 더 엄격하게
  // 순번·연번은 행을 넣거나 지우면 아래가 전부 다시 매겨지므로 비교에서 제외 (행 내용은 그대로 보여줌)
  const isSeqLabel = l => /^(순번|연번|번호|no\.?)$/i.test(norm(l));
  let diffWb = { base: null, reply: null };
  let diffTab = "국가연구개발사업";
  let diffResult = null;
  let diffCols = "all"; // 열 표시: "all" 전체 열 | "changed" 바뀐 열만

  function readWorkbook(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try { resolve(XLSX.read(new Uint8Array(e.target.result), { type: "array" })); } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
      reader.readAsArrayBuffer(file);
    });
  }

  function findSheet(wb, name) { return wb.SheetNames.find(n => norm(n) === norm(name)); }

  // 헤더 바로 아래 줄이 2단 헤더(인건비/간접비/합계 등)인지: 이름 칸이 비었고, 숫자 없이 글자만 2칸 이상
  function isSubHeaderRow(row, nameIdx) {
    const cells = (row || []).map(c => String(c == null ? "" : c).trim()).filter(Boolean);
    if (cells.length < 2) return false;
    if (nameIdx >= 0 && String((row || [])[nameIdx] || "").trim()) return false;
    return cells.every(c => !/^-?[\d,.]+$/.test(c.replace(/\s/g, "")));
  }

  // 시트를 "열 이름 → 값" 행 목록으로 읽음. 열은 헤더 이름으로 맞추므로 열이 추가·삭제돼도 비교 가능
  function extractForDiff(wb, cfg) {
    const sn = findSheet(wb, cfg.sheet);
    if (!sn) return null;
    const ws = wb.Sheets[sn];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });   // 화면 표시용 (엑셀에 보이는 글자)
    const rawAoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }); // 비교용 (실제 값)
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    const hRow = findHeaderRow(aoa, HEADER_KEYWORDS[cfg.sheet]);
    const header = aoa[hRow] || [];
    const nameIdx = colIndex(header, cfg.name);
    const teamIdx = cfg.team ? colIndex(header, cfg.team) : -1;
    const hasSub = isSubHeaderRow(aoa[hRow + 1], nameIdx);
    const sub = hasSub ? aoa[hRow + 1] : [];
    const width = aoa.slice(hRow).reduce((w, r) => Math.max(w, r.length), 0);
    const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

    const labels = [], seen = {};
    let lastTop = "";
    for (let c = 0; c < width; c++) {
      const top = clean(header[c]), s = clean(sub[c]);
      if (top) lastTop = top;
      let label = s ? ((top || lastTop) ? (top || lastTop) + " · " + s : s) : top;
      if (!label) label = "열 " + XLSX.utils.encode_col(range.s.c + c);
      if (seen[label]) { seen[label]++; label += " (" + seen[label] + ")"; } else seen[label] = 1;
      labels.push(label);
    }

    const rows = [];
    for (let r = hRow + (hasSub ? 2 : 1); r < aoa.length; r++) {
      const row = aoa[r] || [];
      if (!row.some(v => clean(v))) continue;
      if (isTotalRow(row)) continue;
      const vals = {}, keys = {}, rawRow = rawAoa[r] || [];
      labels.forEach((l, c) => { vals[l] = clean(row[c]); keys[l] = cmpKey(rawRow[c]); });
      rows.push({
        excelRow: range.s.r + r + 1,
        vals: vals,
        keys: keys,
        name: nameIdx >= 0 ? clean(row[nameIdx]) : "",
        team: cfg.fixedTeam || normTeam(teamIdx >= 0 ? row[teamIdx] : "")
      });
    }
    // 머리글도 값도 없는 빈 열(예: "열 X")은 표에서 뺌
    const used = labels.filter(l => !/^열 [A-Z]+$/.test(l) || rows.some(r => r.vals[l]));
    return { labels: used, rows, nameLabel: nameIdx >= 0 ? labels[nameIdx] : "" };
  }

  // 비교용 값: 표시 형식이 아니라 실제 값으로 비교 (50,000,000 = 50000000, 회계 서식 "-" = 0)
  function cmpKey(v) {
    if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
    const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    if (/^[-–−]$/.test(s)) return "0";
    const n = s.replace(/[,\s₩원]/g, "");
    if (n !== "" && /^-?\d+(\.\d+)?$/.test(n)) return String(Number(n));
    return s;
  }

  function bigrams(s) {
    const t = norm(s), out = [];
    for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
    return out.length ? out : (t ? [t] : []);
  }
  function dice(a, b) {
    if (norm(a) === norm(b)) return 1;
    const A = bigrams(a), B = bigrams(b);
    if (!A.length || !B.length) return 0;
    const m = {};
    A.forEach(x => { m[x] = (m[x] || 0) + 1; });
    let hit = 0;
    B.forEach(x => { if (m[x]) { m[x]--; hit++; } });
    return 2 * hit / (A.length + B.length);
  }
  // 두 행이 같은 과제일 가능성: 이름(과제명·계약명) 60% + 나머지 칸 일치율 40%
  function rowSim(a, b, labels) {
    let both = 0, same = 0;
    labels.forEach(l => {
      const x = a.keys[l] || "", y = b.keys[l] || "";
      if (x || y) { both++; if (x === y) same++; }
    });
    return 0.6 * dice(a.name, b.name) + 0.4 * (both ? same / both : 0);
  }

  // 순서를 지키면서 가장 잘 맞는 행끼리 짝지음 (중간에 행을 넣거나 지워도 아래 행이 밀리지 않게)
  function alignRows(A, B, labels) {
    const n = A.length, m = B.length;
    const S = A.map(a => B.map(b => rowSim(a, b, labels)));
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        let best = Math.max(dp[i - 1][j], dp[i][j - 1]);
        const s = S[i - 1][j - 1];
        if (s >= MATCH_MIN) best = Math.max(best, dp[i - 1][j - 1] + s);
        dp[i][j] = best;
      }
    }
    const pairs = [];
    let i = n, j = m;
    while (i > 0 && j > 0) {
      const s = S[i - 1][j - 1];
      if (s >= MATCH_MIN && Math.abs(dp[i][j] - (dp[i - 1][j - 1] + s)) < 1e-9) { pairs.push([i - 1, j - 1, false]); i--; j--; }
      else if (dp[i][j] === dp[i - 1][j]) i--;
      else j--;
    }
    pairs.reverse();
    const usedA = new Set(pairs.map(p => p[0])), usedB = new Set(pairs.map(p => p[1]));
    // 순서가 바뀐 행: 남은 행끼리 아주 비슷하면 같은 행(위치 이동)으로 봄
    const cand = [];
    A.forEach((_, a) => { if (!usedA.has(a)) B.forEach((__, b) => { if (!usedB.has(b) && S[a][b] >= MOVE_MIN) cand.push([S[a][b], a, b]); }); });
    cand.sort((x, y) => y[0] - x[0]);
    cand.forEach(c => { if (!usedA.has(c[1]) && !usedB.has(c[2])) { usedA.add(c[1]); usedB.add(c[2]); pairs.push([c[1], c[2], true]); } });
    return {
      pairs,
      deleted: A.map((_, a) => a).filter(a => !usedA.has(a)),
      added: B.map((_, b) => b).filter(b => !usedB.has(b))
    };
  }

  function diffSheet(base, reply) {
    const labels = base.labels.concat(reply.labels.filter(l => base.labels.indexOf(l) < 0));
    const cmpLabels = labels.filter(l => !isSeqLabel(l));
    const al = alignRows(base.rows, reply.rows, cmpLabels);
    const changes = [];
    al.pairs.forEach(p => {
      const A = base.rows[p[0]], B = reply.rows[p[1]];
      const cells = cmpLabels.filter(l => (A.keys[l] || "") !== (B.keys[l] || ""))
        .map(l => ({ label: l, before: A.vals[l] || "", after: B.vals[l] || "" }));
      if (cells.length || p[2]) changes.push({ type: "mod", moved: p[2], before: A, after: B, cells, teams: [A.team, B.team] });
    });
    al.deleted.forEach(a => changes.push({ type: "del", before: base.rows[a], teams: [base.rows[a].team] }));
    al.added.forEach(b => changes.push({ type: "add", after: reply.rows[b], teams: [reply.rows[b].team] }));
    changes.sort((x, y) => (x.after || x.before).excelRow - (y.after || y.before).excelRow);
    return {
      labels, changes,
      nameLabel: base.nameLabel || reply.nameLabel,
      colsAdded: reply.labels.filter(l => base.labels.indexOf(l) < 0),
      colsRemoved: base.labels.filter(l => reply.labels.indexOf(l) < 0)
    };
  }

  // 선택한 팀의 변경인지, 다른 팀 영역인지, 팀 미지정 행인지
  function diffBucket(ch, team) {
    if (team === "전체" || ch.teams.indexOf(team) >= 0) return "mine";
    if (ch.teams.every(t => !t)) return "none";
    return "other";
  }

  // 실적 확인과 같은 기준으로 계산한 시트별 실적 합계 (선택 팀만)
  function amountsOf(wb, team) {
    const fns = { "국가연구개발사업": parseNRND, "수탁용역": parseService, "시험인증": parseCert };
    const out = {};
    SHEETS.forEach(s => {
      const sn = findSheet(wb, s);
      const rows = sn ? fns[s](XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "" })) : [];
      out[s] = rows.filter(d => team === "전체" || d.팀 === team).reduce((a, d) => a + toNum(d.실적), 0);
    });
    return out;
  }

  function runDiff() {
    const errBox = document.getElementById("diffErr");
    errBox.innerHTML = "";
    if (!diffWb.base || !diffWb.reply) { diffResult = null; renderDiff(); return; }
    const sheets = {}, missing = [];
    DIFF_SHEETS.forEach(cfg => {
      const b = extractForDiff(diffWb.base, cfg), r = extractForDiff(diffWb.reply, cfg);
      if (!b || !r) { missing.push(cfg.sheet + (b ? " (회신본에 없음)" : r ? " (원본에 없음)" : " (두 파일 모두 없음)")); sheets[cfg.sheet] = null; return; }
      sheets[cfg.sheet] = diffSheet(b, r);
    });
    if (missing.length === DIFF_SHEETS.length) {
      errBox.innerHTML = '<div class="err">' + escapeHtml("비교할 시트를 찾지 못했습니다: 국가연구개발사업, 수탁용역, 시험인증") + "</div>";
      diffResult = null; renderDiff(); return;
    }
    if (missing.length) errBox.innerHTML = '<div class="notice">' + escapeHtml("⚠️ 비교하지 못한 시트: " + missing.join(", ")) + "</div>";
    diffResult = { sheets };
    renderDiff();
  }

  function cellText(v) { return v === "" || v == null ? "(빈칸)" : v; }
  function signed(n) { return (n > 0 ? "+" : n < 0 ? "−" : "±") + fmt(Math.abs(n)); }

  // 엑셀처럼 가로 표로 표시: 왼쪽에 상태·이름 고정, 바뀐 칸은 "이전(취소선) / 이후(노란색)"
  function diffTableHtml(changes, d) {
    let cols = d.labels.filter(l => l !== d.nameLabel);
    if (diffCols === "changed") {
      const hit = {};
      changes.forEach(c => (c.cells || []).forEach(x => { hit[x.label] = true; }));
      const only = cols.filter(l => hit[l]);
      if (only.length) cols = only;
    }
    const changedCell = (x, extra) => '<td class="dc-chg' + (extra || "") + '"><span class="old">' + escapeHtml(cellText(x.before)) +
      '</span><span class="new">' + escapeHtml(cellText(x.after)) + "</span></td>";
    // 머리글 2줄 (엑셀의 병합 머리글처럼): "당해년도 사업비 · 인건비/간접비/합계" → 윗줄에 묶음 이름, 아랫줄에 인건비·간접비·합계
    const split = l => { const i = l.indexOf(" · "); return i < 0 ? [l, ""] : [l.slice(0, i), l.slice(i + 3)]; };
    const thText = t => escapeHtml(t).replace(/([(\[])/g, "<wbr>$1"); // 괄호 앞에서 줄바꿈 허용
    let r1 = '<th class="sc0" rowspan="2">상태</th><th class="sc1" rowspan="2">' + escapeHtml(d.nameLabel || "이름") +
      '</th><th class="nowrap" rowspan="2">엑셀 행</th>', r2 = "";
    for (let i = 0; i < cols.length;) {
      const g = split(cols[i]);
      if (!g[1]) { r1 += '<th rowspan="2"><div class="th-in">' + thText(g[0]) + "</div></th>"; i++; continue; }
      const subs = [];
      while (i < cols.length && split(cols[i])[1] && split(cols[i])[0] === g[0]) { subs.push(split(cols[i])[1]); i++; }
      r1 += '<th class="th-group" colspan="' + subs.length + '"><div class="th-in" style="max-width:' + subs.length * 90 + 'px">' + thText(g[0]) + "</div></th>";
      r2 += subs.map(t => '<th><div class="th-in">' + thText(t) + "</div></th>").join("");
    }
    let h = '<div class="diff-scroll"><table class="diff-table"><thead><tr>' + r1 + "</tr>" + (r2 ? "<tr>" + r2 + "</tr>" : "") + "</thead><tbody>";
    changes.forEach(c => {
      const r = c.after || c.before;
      const tag = c.type === "mod" ? '<span class="tag tag-mod">수정</span>' + (c.moved ? '<span class="tag tag-move">이동</span>' : "")
        : c.type === "add" ? '<span class="tag tag-add">추가</span>' : '<span class="tag tag-del">삭제</span>';
      const rowTxt = c.type === "mod" ? "원본 " + c.before.excelRow + "<br>회신 " + c.after.excelRow
        : c.type === "add" ? "회신 " + c.after.excelRow : "원본 " + c.before.excelRow;
      const byLabel = {};
      (c.cells || []).forEach(x => { byLabel[x.label] = x; });
      h += '<tr class="' + (c.type === "mod" ? "dr-mod" : c.type === "add" ? "dr-add" : "dr-del") + '"><td class="sc0">' + tag + "</td>" +
        (byLabel[d.nameLabel] ? changedCell(byLabel[d.nameLabel], " sc1") : '<td class="sc1">' + escapeHtml(r.name || "(이름 없음)") + "</td>") +
        '<td class="nowrap">' + rowTxt + "</td>" +
        cols.map(l => byLabel[l] ? changedCell(byLabel[l]) : "<td>" + escapeHtml(r.vals[l] || "") + "</td>").join("") + "</tr>";
    });
    return h + "</tbody></table></div>";
  }

  function renderDiff() {
    const host = document.getElementById("diffResult");
    if (!diffResult) { host.innerHTML = ""; return; }
    const team = document.getElementById("diffTeam").value;
    const before = amountsOf(diffWb.base, team), after = amountsOf(diffWb.reply, team);
    const teamName = team === "전체" ? "전체" : team + "팀";
    let totalB = 0, totalA = 0;
    let cards = "";
    const buckets = {};
    SHEETS.forEach(s => {
      totalB += before[s]; totalA += after[s];
      const d = diffResult.sheets[s];
      const bk = { mine: [], other: [], none: [] };
      if (d) d.changes.forEach(ch => bk[diffBucket(ch, team)].push(ch));
      buckets[s] = bk;
      const cnt = t => bk.mine.filter(c => c.type === t).length;
      const delta = after[s] - before[s];
      cards += '<div class="diff-card"><h4>' + escapeHtml(s) + "</h4>" +
        (d ? '<div class="cnt"><span>수정 <b>' + cnt("mod") + "</b></span><span>추가 <b>" + cnt("add") + "</b></span><span>삭제 <b>" + cnt("del") + "</b></span></div>" : '<div class="cnt">시트 없음</div>') +
        '<div class="diff-amt">' + escapeHtml(teamName) + " 실적 " + fmt(before[s]) + " → <b>" + fmt(after[s]) + '</b> <span class="' + (delta > 0 ? "up" : delta < 0 ? "down" : "") + '">(' + signed(delta) + ")</span></div>" +
        (bk.other.length ? '<div class="diff-warn">⚠️ 다른 팀 영역 변경 ' + bk.other.length + "건</div>" : "") + "</div>";
    });
    const td = totalA - totalB;
    let html = '<div class="diff-total">' + escapeHtml(teamName) + " 실적 합계: " + fmt(totalB) + " → <b>" + fmt(totalA) + '</b> <span class="' + (td > 0 ? "up" : td < 0 ? "down" : "") + '">(' + signed(td) + ")</span></div>" +
      '<div class="diff-cards">' + cards + "</div>";

    // 시트 탭 + 변경 목록
    html += '<div class="table-card"><div class="table-tabs" id="diffTabs">' + SHEETS.map(s => {
      const n = buckets[s].mine.length;
      return '<button data-sheet="' + s + '"' + (s === diffTab ? ' class="active"' : "") + ">" + s + " (" + n + ")</button>";
    }).join("") + "</div>";
    const d = diffResult.sheets[diffTab], bk = buckets[diffTab];
    html += '<div class="diff-list">';
    if (!d) {
      html += '<div class="chg-meta">이 시트는 비교하지 못했습니다.</div>';
    } else {
      if (d.colsAdded.length || d.colsRemoved.length) {
        html += '<div class="notice">' + escapeHtml("열 구성이 바뀌었습니다." + (d.colsAdded.length ? "\n · 추가된 열: " + d.colsAdded.join(", ") : "") + (d.colsRemoved.length ? "\n · 없어진 열: " + d.colsRemoved.join(", ") : "")) + "</div>";
      }
      html += '<div class="diff-colmode">열 표시: <button type="button" data-cols="all"' + (diffCols === "all" ? ' class="active"' : "") + '>전체 열</button>' +
        '<button type="button" data-cols="changed"' + (diffCols === "changed" ? ' class="active"' : "") + ">바뀐 열만</button></div>";
      html += bk.mine.length ? diffTableHtml(bk.mine, d) : '<div class="chg-meta">' + escapeHtml(teamName) + " 변경 사항이 없습니다.</div>";
    }
    html += "</div>";
    if (bk.other.length) {
      html += '<details class="more"><summary>⚠️ 다른 팀 영역 변경 ' + bk.other.length + "건 — 실수로 고친 것인지 확인하세요</summary>" + diffTableHtml(bk.other, d) + "</details>";
    }
    if (bk.none.length) {
      html += '<details class="more"><summary>팀 미지정 행 변경 ' + bk.none.length + "건</summary>" + diffTableHtml(bk.none, d) + "</details>";
    }
    html += "</div>";
    host.innerHTML = html;
    fixDiffHeaderTops();
  }

  // 머리글이 2줄일 때 아랫줄도 위에 고정: 윗줄 높이만큼 내려서 붙임 (접혀 있던 표는 펼칠 때 다시 계산)
  function fixDiffHeaderTops() {
    document.querySelectorAll("#diffResult table.diff-table").forEach(t => {
      const rows = t.tHead ? t.tHead.rows : [];
      if (rows.length < 2) return;
      const h = rows[0].getBoundingClientRect().height;
      if (h) [...rows[1].cells].forEach(c => { c.style.top = h + "px"; });
    });
  }

  // 원본·회신본 파일 선택 (버튼 또는 끌어놓기)
  function setDiffFile(which, file) {
    const nameEl = document.getElementById(which === "base" ? "diffBaseName" : "diffReplyName");
    document.getElementById("diffErr").innerHTML = "";
    if (!file || !/\.(xlsx|xls)$/i.test(file.name)) {
      document.getElementById("diffErr").innerHTML = '<div class="err">엑셀 파일(.xlsx 또는 .xls)만 올릴 수 있습니다.</div>';
      return;
    }
    nameEl.textContent = file.name;
    readWorkbook(file).then(wb => { diffWb[which] = wb; runDiff(); }).catch(err => {
      diffWb[which] = null;
      document.getElementById("diffErr").innerHTML = '<div class="err">' + escapeHtml("엑셀 파일을 읽는 중 오류가 발생했습니다.\n" + (err && err.message ? err.message : err)) + "</div>";
    });
  }
  [["base", "diffBase", "diffBaseBox"], ["reply", "diffReply", "diffReplyBox"]].forEach(([which, inputId, boxId]) => {
    document.getElementById(inputId).addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) setDiffFile(which, e.target.files[0]);
      e.target.value = "";
    });
    const box = document.getElementById(boxId);
    box.addEventListener("dragover", function (e) { if (hasDraggedFiles(e)) { e.preventDefault(); box.classList.add("is-dragover"); } });
    box.addEventListener("dragleave", function () { box.classList.remove("is-dragover"); });
    box.addEventListener("drop", function (e) {
      if (!hasDraggedFiles(e)) return;
      e.preventDefault();
      box.classList.remove("is-dragover");
      if (e.dataTransfer.files[0]) setDiffFile(which, e.dataTransfer.files[0]);
    });
  });

  document.getElementById("diffTeam").addEventListener("change", renderDiff);
  document.getElementById("diffResult").addEventListener("toggle", fixDiffHeaderTops, true);
  document.getElementById("diffResult").addEventListener("click", function (e) {
    const cm = e.target.closest(".diff-colmode button[data-cols]");
    if (cm) { diffCols = cm.getAttribute("data-cols"); renderDiff(); return; }
    const b = e.target.closest("#diffTabs button[data-sheet]");
    if (!b) return;
    diffTab = b.getAttribute("data-sheet");
    renderDiff();
  });

  // 상단 모드 전환: 실적 확인 / 변경사항 확인
  document.getElementById("modeTabs").addEventListener("click", function (e) {
    const b = e.target.closest("button[data-mode]");
    if (!b) return;
    const mode = b.getAttribute("data-mode");
    document.querySelectorAll("#modeTabs button").forEach(x => x.classList.toggle("active", x === b));
    document.getElementById("modeDash").style.display = mode === "dash" ? "" : "none";
    document.getElementById("modeDiff").style.display = mode === "diff" ? "" : "none";
  });
})();
