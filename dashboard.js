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
    // 콤마, 원, 공백, 통화기호 제거
    s = s.replace(/[,\s₩원]/g, "");
    // 괄호 음수 표기 (1,000) -> -1000
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.replace(/[()]/g, ""); }
    const n = parseFloat(s);
    if (!isFinite(n)) return 0; // 미정/협약전/미승금/- 등 전부 0
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
  // 시트를 2차원 배열로 받아, keywords가 가장 많이 매칭되는 행을 헤더로 본다.
  function findHeaderRow(rows, keywords) {
    const keys = keywords.map(norm);
    let best = -1, bestScore = 0;
    const scanTo = Math.min(rows.length, 15); // 상위 15행만 탐색
    for (let i = 0; i < scanTo; i++) {
      const cells = (rows[i] || []).map(norm);
      let score = 0;
      keys.forEach(k => { if (cells.some(c => c.includes(k))) score++; });
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return bestScore >= 2 ? best : (best >= 0 ? best : 0);
  }

  // ---- 헤더에서 컬럼 인덱스 찾기 ----------------------------------------
  // 병합셀로 인해 같은 키워드가 여러 곳일 수 있으므로 includes 매칭.
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

  // 국가연구개발사업
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

    // "당해년도 사업비" 블록의 합계 컬럼 찾기.
    // 2단 헤더이므로 헤더행 + 다음 행을 합쳐 "합계" 위치를 추정.
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
      // 과제명과 팀이 모두 비면 잡음행으로 간주
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

  // 수탁용역
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
    // 총 인정실적(A+B)
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

  // 시험인증 (전부 극저온 팀)
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
    // 시험수수료(A) [인정 실적]
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

  // "당해년도 / 사업비" 블록에서 합계 컬럼 인덱스 추정
  function findAmountSumColumn(header, sub, blockKw1, blockKw2) {
    const H = header.map(norm);
    const S = sub.map(norm);
    // 1순위: 서브헤더에서 "합계"이면서 같은 블록 범위
    // 블록 시작 = header에 blockKw가 등장하는 컬럼
    let blockStart = -1, blockEnd = header.length;
    for (let i = 0; i < H.length; i++) {
      if (H[i].includes(norm(blockKw1)) || H[i].includes(norm(blockKw2))) { blockStart = i; break; }
    }
    // "입금기준" 블록 시작 ��까지를 당해년도 블록으로 제한
    for (let i = (blockStart >= 0 ? blockStart + 1 : 0); i < H.length; i++) {
      if (H[i].includes("입금") || H[i].includes("실적")) { blockEnd = i; break; }
    }
    // 서브헤더에서 합계 찾기
    for (let i = Math.max(blockStart, 0); i < blockEnd; i++) {
      if (S[i] && S[i].includes("합계")) return i;
    }
    // 2순위: 헤더 자체에 "합계"
    for (let i = Math.max(blockStart, 0); i < blockEnd; i++) {
      if (H[i] && H[i].includes("합계")) return i;
    }
    // 3순위: 블록 내 인건비/간접비를 찾아 그 다음 칸을 합계로 추정
    let lastFee = -1;
    for (let i = Math.max(blockStart, 0); i < blockEnd; i++) {
      if (S[i] && (S[i].includes("인건비") || S[i].includes("간접비"))) lastFee = i;
    }
    if (lastFee >= 0 && lastFee + 1 < blockEnd) return lastFee + 1;
    return -1;
  }

  // 팀명 정규화
  function normTeam(v) {
    const s = norm(v);
    if (!s) return "";
    if (s.includes("전산")) return "전산";
    if (s.includes("탄소")) return "탄소";
    if (s.includes("극저온") || s.includes("저온")) return "극저온";
    return ""; // 알 수 없는 팀은 빈값 (집계에서 제외)
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
    // 구분 필터는 국가연구개발사업에만 적용, 나머지는 항상 포함
    return [].concat(getFilteredNRND(), RAW["수탁용역"], RAW["시험인증"]);
  }

  function aggregate() {
    const rows = allRowsForAgg();
    const amountByTeam = { "전산": 0, "탄소": 0, "극저온": 0 };
    const countByTeam = { "전산": 0, "탄소": 0, "극저온": 0 };
    let total = 0, count = 0;
    rows.forEach(d => {
      const t = d.팀;
      const amt = toNum(d.실적);
      total += amt; count++;
      if (TEAMS.includes(t)) {
        amountByTeam[t] += amt;
        countByTeam[t] += 1;
      }
    });
    return { amountByTeam, countByTeam, total, count };
  }

  function render() {
    const agg = aggregate();

    // KPI
    setText("kpiCount", agg.count.toLocaleString("ko-KR") + "건");
    setText("kpiCountSub",
      "전산 " + agg.countByTeam["전산"] + " · 탄소 " + agg.countByTeam["탄소"] + " · 극저온 " + agg.countByTeam["극저온"]);
    setText("kpiJeonsan", fmtShort(agg.amountByTeam["전산"]) + "원");
    setText("kpiJeonsanSub", fmt(agg.amountByTeam["전산"]));
    setText("kpiTanso", fmtShort(agg.amountByTeam["탄소"]) + "원");
    setText("kpiTansoSub", fmt(agg.amountByTeam["탄소"]));
    setText("kpiGeo", fmtShort(agg.amountByTeam["극저온"]) + "원");
    setText("kpiGeoSub", fmt(agg.amountByTeam["극저온"]));

    drawTeamAmount(agg);
    drawTeamCount(agg);
    drawCenterShare(agg);
    renderShareCards(agg);
    setText("centerTotal", fmt(agg.total));

    renderTable(currentTab);
  }

  function drawTeamAmount(agg) {
    upsertChart("chartTeamAmount", "bar", {
      labels: TEAMS,
      datasets: [{
        label: "실적 합계(원)",
        data: TEAMS.map(t => Math.round(agg.amountByTeam[t])),
        backgroundColor: TEAMS.map(t => TEAM_COLORS[t]),
        borderRadius: 6
      }]
    }, {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.y) } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => fmtShort(v) } } }
    });
  }

  function drawTeamCount(agg) {
    upsertChart("chartTeamCount", "bar", {
      labels: TEAMS,
      datasets: [{
        label: "과제 수",
        data: TEAMS.map(t => agg.countByTeam[t]),
        backgroundColor: TEAMS.map(t => TEAM_COLORS[t]),
        borderRadius: 6
      }]
    }, {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + "건" } } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    });
  }

  function drawCenterShare(agg) {
    const vals = TEAMS.map(t => Math.round(agg.amountByTeam[t]));
    const sum = vals.reduce((a, b) => a + b, 0);
    upsertChart("chartCenterShare", "doughnut", {
      labels: TEAMS,
      datasets: [{
        data: vals,
        backgroundColor: TEAMS.map(t => TEAM_COLORS[t]),
        borderWidth: 2, borderColor: "#fff"
      }]
    }, {
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: c => {
          const pct = sum > 0 ? ((c.parsed / sum) * 100).toFixed(1) : "0.0";
          return c.label + ": " + fmt(c.parsed) + " (" + pct + "%)";
        } } }
      }
    });
  }

  function renderShareCards(agg) {
    const host = document.getElementById("teamShareCards");
    const sum = TEAMS.reduce((a, t) => a + agg.amountByTeam[t], 0);
    host.innerHTML = TEAMS.map(t => {
      const v = agg.amountByTeam[t];
      const pct = sum > 0 ? ((v / sum) * 100).toFixed(1) : "0.0";
      return '<div class="team-card">' +
        '<div class="tname"><span class="dot" style="background:' + TEAM_COLORS[t] + '"></span>' + t + '팀</div>' +
        '<div class="tval">' + fmt(v) + '</div>' +
        '<div class="tpct">센터 비중 ' + pct + '%</div>' +
        '</div>';
    }).join("");
  }

  // ---- 표 ---------------------------------------------------------------
  const TABLE_COLS = {
    "국가연구개발사업": [
      { k: "구분", h: "구분" }, { k: "팀", h: "팀", team: true }, { k: "관리번호", h: "관리번호" },
      { k: "과제명", h: "과제명" }, { k: "주관기관명", h: "주관기관명" }, { k: "역할", h: "역할" },
      { k: "진행상태", h: "진행상태" }, { k: "실적", h: "당해년도 사업비 합계", num: true }
    ],
    "수탁용역": [
      { k: "팀", h: "담당팀", team: true }, { k: "시험용역항목", h: "시험/용역항목" },
      { k: "과제명", h: "시험·용역 계약명" }, { k: "담당", h: "담당" },
      { k: "실적", h: "총 인정실적(A+B)", num: true }, { k: "비고", h: "비고" }
    ],
    "시험인증": [
      { k: "팀", h: "팀", team: true }, { k: "연번", h: "연번" }, { k: "업체명", h: "업체명" },
      { k: "용역기간", h: "용역기간" }, { k: "과제명", h: "시험/용역항목" }, { k: "담당", h: "담당" },
      { k: "실적", h: "시험수수료(A)", num: true }, { k: "비고", h: "비고" }
    ]
  };

  function renderTable(sheet) {
    const cols = TABLE_COLS[sheet];
    let data = RAW[sheet] || [];
    if (sheet === "국가연구개발사업") data = getFilteredNRND();

    let html = "<table><thead><tr>";
    cols.forEach(c => { html += '<th class="' + (c.num ? "num" : "") + '">' + c.h + "</th>"; });
    html += "</tr></thead><tbody>";

    if (!data.length) {
      html += '<tr><td colspan="' + cols.length + '" style="text-align:center;color:#9ca3af;padding:24px;">표시할 데이터가 없습니다.</td></tr>';
    } else {
      data.forEach(d => {
        html += "<tr>";
        cols.forEach(c => {
          let val = d[c.k];
          if (c.num) {
            html += '<td class="num">' + fmt(toNum(val)) + "</td>";
          } else if (c.team) {
            const t = normTeam(val);
            const badge = TEAM_BADGE[t] || "b-etc";
            html += '<td><span class="badge ' + badge + '">' + (t || (val || "-")) + "</span></td>";
          } else {
            const s = (val === null || val === undefined || String(val).trim() === "") ? "-" : String(val);
            html += "<td>" + escapeHtml(s) + "</td>";
          }
        });
        html += "</tr>";
      });
    }
    html += "</tbody></table>";
    document.getElementById("tableScroll").innerHTML = html;
  }

  // ======================================================================
  //  헬퍼
  // ======================================================================
  function upsertChart(canvasId, type, data, options) {
    if (charts[canvasId]) charts[canvasId].destroy();
    const ctx = document.getElementById(canvasId).getContext("2d");
    charts[canvasId] = new Chart(ctx, {
      type, data,
      options: Object.assign({ responsive: true, maintainAspectRatio: false }, options)
    });
  }
  function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  function showError(msg) { document.getElementById("errBox").innerHTML = '<div class="err">' + escapeHtml(msg) + "</div>"; }
  function clearError() { document.getElementById("errBox").innerHTML = ""; }

  // ======================================================================
  //  이벤트 바인딩
  // ======================================================================
  document.getElementById("fileInput").addEventListener("change", function (e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    document.getElementById("fileName").textContent = f.name;
    handleFile(f);
  });

  document.getElementById("filterBox").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    currentGubun = btn.getAttribute("data-gubun");
    document.querySelectorAll("#filterBox .chip").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    render();
  });

  document.getElementById("tableTabs").addEventListener("click", function (e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    currentTab = btn.getAttribute("data-sheet");
    document.querySelectorAll("#tableTabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderTable(currentTab);
  });
})();
