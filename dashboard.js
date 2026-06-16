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

  let RAW = { "국가연구개발사업": [], "수탁용역": [], "시험인증": [] };
  let GOAL = 0; // 운용자금 목표금액 ('분기별 보고' 시트에서 자동 탐지). 못 찾으면 0
  let currentTab = "국가연구개발사업";
  const charts = {};

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

  function isTotalRow(rowJoined) {
    const s = norm(rowJoined);
    return s.includes("합계") || s.includes("총계") || s.includes("소계") || s === "계";
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
      { k: "실적", h: "당해년도 사업비 합계", num: true, w: 128 }
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

  function renderTable(sheet) {
    const cols = TABLE_COLS[sheet];
    const data = RAW[sheet] || [];

    let html = "<table><colgroup>";
    cols.forEach(c => { html += c.w ? ('<col style="width:' + c.w + 'px;">') : "<col>"; });
    html += "</colgroup><thead><tr>";
    cols.forEach(c => { html += '<th class="' + alignClass(c) + '">' + c.h + "</th>"; });
    html += "</tr></thead><tbody>";

    if (!data.length) {
      html += '<tr><td colspan="' + cols.length + '" style="text-align:center;color:#9ca3af;padding:24px;">표시할 데이터가 없습니다.</td></tr>';
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
    document.getElementById("tableScroll").innerHTML = html;
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

  document.getElementById("fileInput").addEventListener("change", function (e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    document.getElementById("fileName").textContent = f.name;
    handleFile(f);
  });

  document.getElementById("btnCapture").addEventListener("click", exportImage);
  document.getElementById("btnPdf").addEventListener("click", exportPdf);

  document.getElementById("tableTabs").addEventListener("click", function (e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    currentTab = btn.getAttribute("data-sheet");
    document.querySelectorAll("#tableTabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderTable(currentTab);
  });
})();
