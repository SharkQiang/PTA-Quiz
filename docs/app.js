/* ============================================================
 * PTA刷题 · 网页通用版 v0.1
 * 单文件逻辑，零依赖。数据来自同目录 data/*.js（题库，随包内置）。
 * 规则与安卓版一致：
 *   1. 多选必须全对才得分（漏选、错选均 0 分）
 *   2. 错题永不自动添加：只有用户确认才写入错题本
 *   3. 错题只在「错题重刷」里答对才移出；别处答对/答错都不影响错题本
 *   4. 提交后本题锁定，可「上一题」回看但不可改
 * ============================================================ */
(function () {
  'use strict';

  // ---------------- 存储 ----------------
  var LS = {
    settings: 'pta_web_settings',
    wrong: 'pta_web_wrong',
    fav: 'pta_web_fav',
    records: 'pta_web_records'
  };

  function load(key, def) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : def;
    } catch (e) { return def; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式下忽略 */ }
  }

  var DEFAULT_SETTINGS = { theme: 'system', dailyCount: 10, passLine: 80, scope: 'MIXED' };
  var settings = Object.assign({}, DEFAULT_SETTINGS, load(LS.settings, {}));
  var wrongMap = load(LS.wrong, {});          // qid -> { wrongCount, reviewCount, ... }
  var favList = load(LS.fav, []);             // [qid]
  var favSet = new Set(favList);
  var records = load(LS.records, []);         // { qid, mode, correct, scoreGot, scoreFull, at }

  // ---------------- 题库 ----------------
  var BANK = (function () {
    var out = [];
    function push(bank, defSource) {
      if (!bank || !Array.isArray(bank.questions)) return;
      bank.questions.forEach(function (q) {
        out.push({
          id: q.id,
          source: q.source || defSource,
          sourceLabel: q.sourceLabel || '',
          vol: q.vol || 0,
          no: q.no || 0,
          type: q.type || 'single',
          score: q.score || 3,
          stem: q.stem || '',
          options: q.options || [],
          answer: q.answer || [],
          analysis: q.analysis || '',
          hint: q.hint || '',
          tags: q.tags || [],
          category: q.category || ''
        });
      });
    }
    push(window.PTA_LOCAL_BANK, 'local');
    push(window.PTA_NETWORK_BANK, 'network');
    return out;
  })();

  var BY_ID = {};
  BANK.forEach(function (q) { BY_ID[q.id] = q; });

  // ---------------- 判分（与安卓版 Grade.kt 完全一致） ----------------
  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    var x = a.slice().sort(), y = b.slice().sort();
    for (var i = 0; i < x.length; i++) { if (x[i] !== y[i]) return false; }
    return true;
  }
  function isCorrect(q, sel) { return sameSet(q.answer, sel); }

  // ---------------- 主题 ----------------
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function isDarkNow() {
    if (settings.theme === 'dark') return true;
    if (settings.theme === 'light') return false;
    return !!(mq && mq.matches);
  }
  function applyTheme() {
    var dark = isDarkNow();
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#1C1C1A' : '#F7F7F5');
  }
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function () { if (settings.theme === 'system') { applyTheme(); } });
  }

  // ---------------- 小工具 ----------------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function $(sel) { return document.querySelector(sel); }
  function dayStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sourceLabelOf(q) { return q.sourceLabel || (q.source === 'network' ? '网络补充' : '本地真题'); }
  function wrongCount() { return Object.keys(wrongMap).length; }

  function scopeSources(scope) {
    if (scope === 'LOCAL') return ['local'];
    if (scope === 'NETWORK') return ['network'];
    return ['local', 'network'];
  }
  function bankOf(scope) {
    var srcs = scopeSources(scope);
    return BANK.filter(function (q) { return srcs.indexOf(q.source) >= 0; });
  }

  // ---------------- 记录 ----------------
  function pushRecord(q, mode, correct) {
    records.push({ qid: q.id, mode: mode, correct: !!correct, scoreGot: correct ? q.score : 0, scoreFull: q.score, at: Date.now() });
    if (records.length > 8000) records = records.slice(records.length - 8000);
    save(LS.records, records);
  }

  // ---------------- 错题本 ----------------
  function addToWrong(q, sel, from) {
    var now = Date.now();
    var cur = wrongMap[q.id];
    if (!cur) {
      wrongMap[q.id] = {
        wrongCount: 1, reviewCount: 0, lastUserAnswer: sel || [],
        addedFrom: from, addedAt: now, lastWrongAt: now, source: q.source
      };
    } else {
      cur.wrongCount += 1;
      cur.reviewCount += 1;
      cur.lastUserAnswer = sel || [];
      cur.lastWrongAt = now;
    }
    save(LS.wrong, wrongMap);
  }
  function removeWrong(id) { delete wrongMap[id]; save(LS.wrong, wrongMap); }

  function setFav(id, on) {
    if (on) { favSet.add(id); } else { favSet.delete(id); }
    favList = Array.from(favSet);
    save(LS.fav, favList);
  }

  // ---------------- 会话状态 ----------------
  var session = null;   // { mode, list, idx, states[], startAt, qStart }
  var detail = null;    // { q, sel:[], submitted, correct, practice:false, hint:false }
  var search = { kw: '', vol: 0, cat: '', source: '', result: [] };
  var route = { name: 'home' };
  var msg = '';
  var confirmBox = null;

  function newState() {
    return { sel: [], submitted: false, correct: false, confirmed: false, joinedWrong: false, hintUsed: false };
  }

  function startSession(mode, list) {
    if (!list.length) { msg = '当前范围内没有题目。'; render(); return; }
    session = { mode: mode, list: list, idx: 0, states: list.map(newState), startAt: Date.now(), qStart: Date.now() };
    msg = '';
    route = { name: 'quiz' };
    render();
  }

  function curQ() { return session ? session.list[session.idx] : null; }
  function curS() { return session ? session.states[session.idx] : null; }

  function submitCurrent(auto) {
    var q = curQ(), st = curS();
    if (!q || !st) return;
    if (st.submitted) return;                                   // 幂等：防连点
    if (!st.sel.length && !auto) { msg = '请先选择答案'; render(); return; }
    st.submitted = true;
    st.correct = isCorrect(q, st.sel);
    pushRecord(q, session.mode, st.correct);
    if (session.mode === 'review') {
      // 错题重刷：答对立即移出；答错保留并累计
      if (st.correct) { removeWrong(q.id); } else { addToWrong(q, st.sel, 'review'); }
    }
    msg = '';
    render();
  }

  function confirmWrong(join) {
    var q = curQ(), st = curS();
    if (!q || !st) return;
    if (st.confirmed) return;                                   // 幂等：连点不会重复写入
    st.confirmed = true;
    st.joinedWrong = !!join;
    if (join) { addToWrong(q, st.sel, session.mode); }
    render();
  }

  function sessionResult() {
    var got = 0, full = 0, correct = 0, joined = 0;
    session.states.forEach(function (s, i) {
      var q = session.list[i];
      full += q.score;
      if (s.submitted && s.correct) { got += q.score; correct++; }
      if (s.joinedWrong) joined++;
    });
    var percent = full > 0 ? Math.round(got / full * 100) : 0;
    return { got: got, full: full, correct: correct, total: session.list.length, percent: percent, joined: joined, passed: percent >= settings.passLine };
  }

  // ---------------- 视图：首页 ----------------
  function viewHome() {
    var total = records.length;
    var ok = records.filter(function (r) { return r.correct; }).length;
    var acc = total ? Math.round(ok / total * 100) : 0;
    var today = records.filter(function (r) { return r.at >= dayStart(); }).length;
    var localN = BANK.filter(function (q) { return q.source === 'local'; }).length;
    var netN = BANK.filter(function (q) { return q.source === 'network'; }).length;

    return '' +
      '<div class="card tinted">' +
        '<div class="t-title" style="font-size:12px">今日概览</div>' +
        '<div class="t-body" style="margin-top:4px;font-size:15px">今日已练 ' + today + ' 题 · 正确率 ' + acc + '%</div>' +
      '</div>' +
      '<div class="grid2">' +
        stat('累计答题', total) + stat('总正确率', acc + '%') +
      '</div>' +
      '<div class="grid2" style="margin-top:12px">' +
        stat('错题数', wrongCount()) + stat('收藏数', favSet.size) +
      '</div>' +
      '<div class="section-title"><span>开始练习</span><span>本地 ' + localN + ' · 网补 ' + netN + '</span></div>' +
      '<button class="btn btn-primary btn-block" data-act="start-random">随机刷题（整套 30 题）</button>' +
      '<button class="btn btn-block" data-act="start-daily">每日速记（' + settings.dailyCount + ' 题）</button>' +
      '<button class="btn btn-block" data-act="go" data-to="search">题库检索</button>' +
      '<button class="btn btn-block" data-act="go" data-to="wrong">错题本（' + wrongCount() + '）</button>' +
      '<footer class="about">PTA刷题 · 网页通用版 v0.1<br>by 穆辰</footer>';
  }
  function stat(k, v) { return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'; }

  // ---------------- 视图：答题 ----------------
  function viewQuiz() {
    if (!session) return '<div class="empty">没有正在进行的练习</div>';
    if (session.mode === 'review') { return viewReview(); }

    var q = curQ(), st = curS();
    if (!q) return '<div class="empty">题目为空</div>';
    var multi = q.type === 'multi';
    var total = session.list.length;

    var html = '' +
      '<div class="section-title"><span>第 ' + (session.idx + 1) + '/' + total + ' 题</span>' +
      '<span>已答 ' + session.states.filter(function (s) { return s.submitted; }).length + '/' + total + '</span></div>' +
      '<div class="progress"><i style="width:' + Math.round((session.idx + 1) / total * 100) + '%"></i></div>' +
      '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span class="source-chip">' + esc(sourceLabelOf(q)) + '</span>' +
          '<span class="tiny">' + (multi ? '多选题' : '单选题') + ' · ' + q.score + ' 分</span>' +
        '</div>' +
        '<div class="stem">' + esc(q.stem) + '</div>' +
      '</div>';

    html += optionList(q, st, multi);

    if (q.hint) {
      html += '<div class="hint-box">' +
        '<div class="hint-head" data-act="hint">' + (st.hint ? '提示（点击收起）' : '提示（点击展开）') + '</div>' +
        (st.hint ? '<div style="margin-top:8px">' + esc(q.hint) + '</div>' : '') +
      '</div>';
    }

    if (st.submitted) {
      html += answerPanel(q, st.correct);
      html += '<div class="tiny" style="margin-top:6px">本题已提交，答案不可修改（可用「上一题」回看）</div>';
    }

    if (session.mode === 'daily' && st.submitted && !st.correct) {
      if (!st.confirmed) {
        html += '<div class="ask">' +
          '<div style="font-size:14px;margin-bottom:8px">这道题答错了，要加入错题本吗？</div>' +
          '<div class="row">' +
            '<button class="btn" data-act="cw" data-v="1">加入错题本</button>' +
            '<button class="btn" data-act="cw" data-v="0">暂不加入</button>' +
          '</div></div>';
      } else {
        html += '<div class="tiny" style="margin-top:8px">' + (st.joinedWrong ? '已加入错题本' : '本次未加入错题本') + '</div>';
      }
    }
    if (session.mode === 'daily' && st.submitted && st.correct) {
      html += '<div class="tiny" style="margin-top:8px;color:var(--correct)">回答正确，本题无需加入错题本</div>';
    }

    var canNext = st.submitted && (session.mode !== 'daily' || st.correct || st.confirmed);
    html += '<div class="row" style="margin-top:12px">' +
      '<button class="btn" data-act="prev" ' + (session.idx > 0 ? '' : 'disabled') + ' style="flex:1">上一题</button>' +
      (st.submitted
        ? '<button class="btn btn-primary" data-act="next" ' + (canNext ? '' : 'disabled') + ' style="flex:1.4">' + (session.idx === total - 1 ? '查看结算' : '下一题') + '</button>'
        : '<button class="btn btn-primary" data-act="submit" style="flex:1.4">提交答案</button>') +
      '</div>';

    if (msg) { html += '<div class="msg">' + esc(msg) + '</div>'; }
    html += '<button class="btn btn-block" data-act="quit">结束本次练习</button>';
    return html;
  }

  function optionList(q, st, multi) {
    var keys = ['A', 'B', 'C', 'D', 'E', 'F'];
    return q.options.map(function (text, i) {
      var k = keys[i] || String(i + 1);
      var cls = 'option';
      if (!st.submitted) {
        if (st.sel.indexOf(k) >= 0) cls += ' selected';
      } else {
        cls += ' locked';
        if (q.answer.indexOf(k) >= 0) cls += ' correct';
        else if (st.sel.indexOf(k) >= 0) cls += ' wrong';
      }
      return '<div class="' + cls + '" data-multi="' + (multi ? 1 : 0) + '" data-act="opt" data-k="' + k + '">' +
        '<span class="mark"></span><span>' + k + '. ' + esc(text) + '</span></div>';
    }).join('');
  }

  function answerPanel(q, correct) {
    return '<div class="panel ' + (correct ? 'ok' : 'no') + '">' +
      '<div class="verdict">' + (correct ? '回答正确' : '回答错误') + '</div>' +
      '<div style="margin-top:4px">标准答案：' + esc(q.answer.join('')) + '</div>' +
      '<div style="margin-top:8px;border-top:1px solid var(--outline);padding-top:8px">解析：' + esc(q.analysis) + '</div>' +
      (q.category || q.tags.length
        ? '<div class="tiny" style="margin-top:8px">' + (q.category ? '知识点分类：' + esc(q.category) + '  ' : '') + esc(q.tags.map(function (t) { return '#' + t; }).join(' ')) + '</div>'
        : '') +
      '</div>';
  }

  // ---------------- 视图：错题重刷（进度分母固定） ----------------
  function viewReview() {
    var q = curQ(), st = curS();
    var total = session.list.length;                     // 固定总数，答对移出也不会让分母变小
    var answered = session.states.filter(function (s) { return s.submitted; }).length;

    var html = '' +
      '<div class="section-title"><span>错题重刷 ' + (session.idx + 1) + '/' + total + '</span><span>已答 ' + answered + '/' + total + '</span></div>' +
      '<div class="progress"><i style="width:' + Math.round((session.idx + 1) / total * 100) + '%"></i></div>' +
      '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span class="source-chip">' + esc(sourceLabelOf(q)) + '</span>' +
          '<span class="tiny">' + (q.type === 'multi' ? '多选题' : '单选题') + ' · ' + q.score + ' 分</span>' +
        '</div>' +
        '<div class="stem">' + esc(q.stem) + '</div>' +
      '</div>' +
      optionList(q, st, q.type === 'multi');

    if (st.submitted) {
      html += answerPanel(q, st.correct);
      html += '<div class="tiny" style="margin-top:6px;color:' + (st.correct ? 'var(--correct)' : 'var(--wrong)') + '">' +
        (st.correct ? '答对了，已移出错题本' : '仍答错，错次 +1，继续留在错题本') + '</div>';
    }

    html += '<div class="row" style="margin-top:12px">' +
      '<button class="btn" data-act="prev" ' + (session.idx > 0 ? '' : 'disabled') + ' style="flex:1">上一题</button>' +
      (st.submitted
        ? '<button class="btn btn-primary" data-act="next" style="flex:1.4">' + (session.idx === total - 1 ? '完成重刷' : '下一题') + '</button>'
        : '<button class="btn btn-primary" data-act="submit" ' + (st.sel.length ? '' : 'disabled') + ' style="flex:1.4">提交并重判</button>') +
      '</div>';

    if (!st.submitted && !st.sel.length) { html += '<div class="tiny" style="margin-top:6px">请先选择答案再提交</div>'; }
    html += '<button class="btn btn-block" data-act="quit">结束重刷</button>';
    return html;
  }

  // ---------------- 视图：结算 ----------------
  function viewResult() {
    var r = sessionResult();
    var modeLabel = session.mode === 'daily' ? '每日速记' : '随机刷题';
    return '<div class="section-title"><span>本次' + modeLabel + '结算</span><span>及格线 ' + settings.passLine + ' 分</span></div>' +
      '<div class="card">' +
        '<div style="font-size:22px;font-weight:600">得分 ' + r.percent + ' 分（' + r.got + '/' + r.full + '）</div>' +
        '<div style="margin-top:6px;color:' + (r.passed ? 'var(--accent)' : 'var(--warn)') + '">' + (r.passed ? '已达标' : '未达标，建议重点复习错题') + '</div>' +
        '<div class="tiny" style="margin-top:6px">答对 ' + r.correct + '/' + r.total + ' 题' +
          (session.mode === 'daily' ? ' · 本次加入错题本 ' + r.joined + ' 道' : '') + '</div>' +
      '</div>' +
      (session.mode !== 'daily' ? '<div class="tiny" style="margin-bottom:8px">随机刷题不会自动写错题本；可在「题目详情」或「每日速记」中手动加入。</div>' : '') +
      '<button class="btn btn-primary btn-block" data-act="again">再来一次</button>' +
      '<button class="btn btn-block" data-act="go" data-to="home">返回首页</button>' +
      '<button class="btn btn-block" data-act="go" data-to="wrong">去错题本复习</button>';
  }

  // ---------------- 视图：检索 ----------------
  function viewSearch() {
    var srcs = scopeSources(search.source || 'MIXED');
    var pool = BANK.filter(function (q) { return srcs.indexOf(q.source) >= 0; });

    var vols = [];
    var cats = [];
    pool.forEach(function (q) {
      if (q.source === 'local' && q.vol && vols.indexOf(q.vol) < 0) vols.push(q.vol);
      if (q.category && cats.indexOf(q.category) < 0) cats.push(q.category);
    });
    vols.sort(function (a, b) { return a - b; });
    cats.sort();

    var showVols = (search.source || 'MIXED') !== 'NETWORK';

    var html = '<div class="section-title"><span>题库检索</span><span>本地 ' + BANK.filter(function (q) { return q.source === 'local'; }).length +
      ' · 网补 ' + BANK.filter(function (q) { return q.source === 'network'; }).length +
      ' · 合计 ' + BANK.length + ' 题</span></div>';

    html += '<input id="kw" class="btn" type="search" placeholder="输入关键词搜索" value="' + esc(search.kw) + '" style="width:100%;text-align:left">';

    html += '<div class="section-title"><span>来源</span></div><div class="row">' +
      chip('全部来源', !search.source, 'src', '') +
      chip('本地真题', search.source === 'local', 'src', 'local') +
      chip('网络补充', search.source === 'network', 'src', 'network') +
      '</div>';

    if (showVols && vols.length) {
      html += '<div class="section-title"><span>卷号</span></div><div class="row">' +
        chip('全部卷', !search.vol, 'vol', '0') +
        vols.map(function (v) { return chip('第 ' + v + ' 卷', search.vol === v, 'vol', String(v)); }).join('') +
        '</div>';
    }
    if (cats.length) {
      html += '<div class="section-title"><span>分类</span></div><div class="row">' +
        chip('全部分类', !search.cat, 'cat', '') +
        cats.map(function (c) { return chip(c, search.cat === c, 'cat', c); }).join('') +
        '</div>';
    }

    html += '<div id="search-results"></div>';
    return html;
  }

  function chip(label, on, act, val) {
    return '<button class="chip' + (on ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(val) + '">' + esc(label) + '</button>';
  }

  function runSearch() {
    var kw = search.kw.trim();
    var srcs = scopeSources(search.source || 'MIXED');
    var list = BANK.filter(function (q) {
      if (srcs.indexOf(q.source) < 0) return false;
      if (search.vol && q.vol !== search.vol) return false;
      if (search.cat && q.category !== search.cat) return false;
      if (kw) {
        var hay = q.stem + ' ' + q.options.join(' ') + ' ' + q.category + ' ' + q.tags.join(' ');
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
    search.result = list;

    var box = document.getElementById('search-results');
    if (!box) return;
    if (!list.length) { box.innerHTML = '<div class="empty">没有匹配的题目</div>'; return; }
    box.innerHTML = '<div class="section-title"><span>结果 ' + list.length + ' 题</span><span>点击查看详情</span></div>' +
      (list.length > 200 ? '<div class="tiny" style="margin-bottom:8px">仅显示前 200 条</div>' : '') +
      list.slice(0, 200).map(function (q) {
        return '<div class="item" data-act="detail" data-id="' + esc(q.id) + '">' +
          '<div class="l1">' + esc(sourceLabelOf(q)) + '</div>' +
          '<div class="l2">' + esc(q.stem) + '</div></div>';
      }).join('');
  }

  // ---------------- 视图：题目详情 ----------------
  function viewDetail() {
    if (!detail) return '<div class="empty">题目不存在</div>';
    var q = detail.q;
    var isFav = favSet.has(q.id);
    var isWrong = !!wrongMap[q.id];

    var html = '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span class="source-chip">' + esc(sourceLabelOf(q)) + '</span>' +
          '<span class="tiny">' + (q.type === 'multi' ? '多选题' : '单选题') + ' · ' + q.score + ' 分</span>' +
        '</div>' +
        '<div class="stem">' + esc(q.stem) + '</div>' +
      '</div>';

    if (detail.practice) {
      var st = { sel: detail.sel, submitted: detail.submitted, correct: detail.correct };
      html += optionList(q, st, q.type === 'multi');
      if (detail.submitted) { html += answerPanel(q, detail.correct); }
      else { html += '<button class="btn btn-primary btn-block" data-act="d-submit">提交</button>'; }
      html += '<button class="btn btn-block" data-act="d-mode">切换到浏览模式</button>';
    } else {
      html += '<div class="card"><div class="tiny">标准答案</div><div style="font-size:18px;font-weight:600;margin-top:4px">' + esc(q.answer.join('')) + '</div></div>';
      html += '<div class="card"><div class="tiny">解析</div><div style="margin-top:4px;font-size:14px">' + esc(q.analysis) + '</div></div>';
      html += '<button class="btn btn-primary btn-block" data-act="d-mode">我做做看</button>';
    }

    html += '<div class="row" style="margin-top:8px">' +
      '<button class="btn" data-act="d-fav" style="flex:1">' + (isFav ? '取消收藏' : '收藏') + '</button>' +
      '<button class="btn" data-act="d-wrong" style="flex:1">' + (isWrong ? '移出错题本' : '加入错题本') + '</button>' +
      '</div>';
    if (msg) { html += '<div class="msg">' + esc(msg) + '</div>'; }
    return html;
  }

  // ---------------- 视图：错题本 ----------------
  var wrongFilter = null;   // null | 'local' | 'network'
  function viewWrong() {
    var ids = Object.keys(wrongMap);
    var list = ids.map(function (id) { return { id: id, q: BY_ID[id], w: wrongMap[id] }; })
      .filter(function (x) { return x.q; });
    if (wrongFilter) { list = list.filter(function (x) { return x.q.source === wrongFilter; }); }
    list.sort(function (a, b) { return (b.w.lastWrongAt || 0) - (a.w.lastWrongAt || 0); });

    var html = '<div class="section-title"><span>错题本（' + ids.length + '）</span></div>' +
      '<div class="row">' +
        chip('全部', !wrongFilter, 'wf', '') +
        chip('本地真题', wrongFilter === 'local', 'wf', 'local') +
        chip('网络补充', wrongFilter === 'network', 'wf', 'network') +
      '</div>' +
      '<div class="tiny" style="margin:10px 0">错题只在「错题重刷」里答对才会移出；在随机刷题 / 每日速记 / 题目详情里答对或答错，都不会改变这里的记录。</div>';

    if (!list.length) {
      html += '<div class="empty">暂无错题，保持得不错</div>';
      return html;
    }
    html += list.map(function (x) {
      return '<div class="item" data-act="detail" data-id="' + esc(x.id) + '">' +
        '<div class="l1">' + esc(sourceLabelOf(x.q)) + '</div>' +
        '<div class="l2">' + esc(x.q.stem) + '</div>' +
        '<div class="l3"><span>上次作答：' + esc((x.w.lastUserAnswer || []).join('') || '未答') + ' · 错 ' + (x.w.wrongCount || 0) + ' 次</span>' +
        '<span class="danger" data-act="w-remove" data-id="' + esc(x.id) + '">移出错题本</span></div>' +
      '</div>';
    }).join('');
    html += '<button class="btn btn-primary btn-block" data-act="review-start">错题重刷（' + list.length + '）</button>';
    return html;
  }

  // ---------------- 视图：收藏 ----------------
  function viewFav() {
    var list = favList.map(function (id) { return BY_ID[id]; }).filter(Boolean);
    var html = '<div class="section-title"><span>收藏夹（' + list.length + '）</span></div>';
    if (!list.length) { return html + '<div class="empty">还没有收藏的题目</div>'; }
    html += list.map(function (q) {
      return '<div class="item" data-act="detail" data-id="' + esc(q.id) + '">' +
        '<div class="l1">' + esc(sourceLabelOf(q)) + '</div>' +
        '<div class="l2">' + esc(q.stem) + '</div></div>';
    }).join('');
    return html;
  }

  // ---------------- 视图：设置 ----------------
  function viewSettings() {
    var scopeChip = function (v, label) { return chip(label, settings.scope === v, 'scope', v); };
    return '<div class="card">' +
        '<div style="font-weight:600;margin-bottom:8px">外观</div>' +
        '<div class="section-title"><span>显示模式</span><span>当前：' +
          (settings.theme === 'light' ? '浅色' : settings.theme === 'dark' ? '深色' : '跟随系统') + '</span></div>' +
        '<div class="row">' +
          chip('跟随系统', settings.theme === 'system', 'theme', 'system') +
          chip('浅色', settings.theme === 'light', 'theme', 'light') +
          chip('深色', settings.theme === 'dark', 'theme', 'dark') +
        '</div>' +
        '<div class="tiny" style="margin-top:8px">浅色为亮底深字（白天用），深色为暗底浅字（夜间用）；选「跟随系统」则由手机 / 电脑系统设置决定。切换后立即生效。</div>' +
      '</div>' +

      '<div class="card">' +
        '<div style="font-weight:600;margin-bottom:8px">练习设置</div>' +
        '<div class="section-title"><span>每日速记题量</span><span>当前 ' + settings.dailyCount + ' 题</span></div>' +
        '<div class="row">' + [5, 10, 15, 20].map(function (n) { return chip(n + ' 题', settings.dailyCount === n, 'daily', String(n)); }).join('') + '</div>' +
        '<div class="section-title"><span>及格线</span><span>官方通过线 60 分，当前 ' + settings.passLine + ' 分</span></div>' +
        '<div class="row">' + [60, 70, 80, 90].map(function (n) { return chip(n + ' 分', settings.passLine === n, 'pass', String(n)); }).join('') + '</div>' +
        '<div class="section-title"><span>默认题库范围</span></div>' +
        '<div class="row">' + scopeChip('LOCAL', '仅本地真题') + scopeChip('NETWORK', '仅网络补充') + scopeChip('MIXED', '混合题库') + '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div style="font-weight:600;margin-bottom:8px">数据管理</div>' +
        '<div class="tiny">题库 ' + BANK.length + ' 题 · 刷题记录 ' + records.length + ' 条 · 错题 ' + wrongCount() + ' 道 · 收藏 ' + favSet.size + ' 道</div>' +
        '<button class="btn btn-block" data-act="clear-records">清空刷题记录</button>' +
        '<button class="btn btn-block" data-act="clear-wrong">清空错题本</button>' +
        '<div class="tiny" style="margin-top:8px">数据存在这台设备的浏览器里（localStorage），不上传任何服务器。</div>' +
      '</div>' +

      '<div class="card">' +
        '<div style="font-weight:600;margin-bottom:8px">关于</div>' +
        '<div style="font-size:13px;font-weight:600;margin-top:6px">开发者：穆辰</div>' +
        '<div class="tiny" style="margin-top:2px">本应用由穆辰独立设计并开发（题库整理、界面与全部功能）。</div>' +
        '<div class="tiny" style="margin-top:8px">官方 T1：共 30 题、满分 100 分、60 分及以上通过；本应用内及格线为自定标准。</div>' +
        '<div class="tiny" style="margin-top:8px">「本地真题」整理自 CCF PTA 官方已公开发布的历次认证试卷，版权归中国计算机学会（CCF）所有；本应用与 CCF 无任何关联。「网络补充」为依据官方大纲自命题的衍生模拟题，非官方真题。</div>' +
        '<div class="tiny" style="margin-top:8px">网页通用版 v0.1 · 安卓版见 07_安装包</div>' +
      '</div>';
  }

  // ---------------- 路由与渲染 ----------------
  var TITLES = { home: ['PTA刷题', 'by 穆辰'], quiz: ['练习中', ''], result: ['结算', ''], search: ['题库检索', ''], detail: ['题目详情', ''], wrong: ['错题本', ''], fav: ['收藏夹', ''], settings: ['设置', ''] };
  var TAB_OF = { home: 'home', quiz: 'home', result: 'home', search: 'home', detail: 'home', wrong: 'wrong', fav: 'fav', settings: 'settings' };

  function render() {
    applyTheme();

    var body = '';
    switch (route.name) {
      case 'home': body = viewHome(); break;
      case 'quiz': body = viewQuiz(); break;
      case 'result': body = viewResult(); break;
      case 'search': body = viewSearch(); break;
      case 'detail': body = viewDetail(); break;
      case 'wrong': body = viewWrong(); break;
      case 'fav': body = viewFav(); break;
      case 'settings': body = viewSettings(); break;
      default: body = '<div class="empty">页面不存在</div>';
    }
    $('#main').innerHTML = body;

    var t = TITLES[route.name] || TITLES.home;
    $('#page-title').textContent = t[0];
    $('#page-sub').textContent = t[1];

    var back = $('#btn-back');
    if (route.name === 'home') { back.classList.add('hidden'); } else { back.classList.remove('hidden'); }

    var tab = TAB_OF[route.name] || 'home';
    Array.prototype.forEach.call(document.querySelectorAll('#tabbar button'), function (b) {
      if (b.getAttribute('data-tab') === tab) { b.classList.add('active'); } else { b.classList.remove('active'); }
    });

    if (route.name === 'search') {
      runSearch();
      var kw = document.getElementById('kw');
      if (kw) {
        kw.oninput = function () { search.kw = kw.value; runSearch(); };
      }
    }
  }

  // ---------------- 事件 ----------------
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-act],[data-tab]') : null;
    if (!t) return;

    // 底部导航
    var tabName = t.getAttribute('data-tab');
    if (tabName) {
      msg = '';
      if (tabName === 'home') { session = null; }
      route = { name: tabName };
      window.scrollTo(0, 0);
      render();
      return;
    }

    var act = t.getAttribute('data-act');
    var v = t.getAttribute('data-v');

    // 先处理嵌套在可点击卡片里的操作（如错题本里的「移出」）
    if (act === 'w-remove') {
      ev.stopPropagation();
      var rid = t.getAttribute('data-id');
      confirmBox = {
        title: '移出错题本？', text: '这道题将从错题本中删除。',
        onOk: function () { removeWrong(rid); confirmBox = null; renderDialog(); render(); }
      };
      renderDialog();
      return;
    }

    switch (act) {
      case 'go':
        msg = '';
        if (t.getAttribute('data-to') === 'home') { session = null; }
        route = { name: t.getAttribute('data-to') };
        window.scrollTo(0, 0); render(); return;

      case 'start-random':
        startSession('random', shuffle(bankOf(settings.scope)).slice(0, 30)); return;

      case 'start-daily':
        startSession('daily', shuffle(bankOf(settings.scope)).slice(0, settings.dailyCount)); return;

      case 'opt': {
        var k = t.getAttribute('data-k');
        // 题目详情页的「我做做看」
        if (route.name === 'detail') {
          if (!detail || !detail.practice || detail.submitted) return;
          var qd = detail.q;
          if (qd.type === 'multi') {
            var j = detail.sel.indexOf(k);
            if (j >= 0) { detail.sel.splice(j, 1); } else { detail.sel.push(k); }
          } else {
            detail.sel = [k];
          }
          msg = ''; render(); return;
        }
        if (route.name !== 'quiz' || !session) return;
        var st = curS(), q = curQ();
        if (!st || st.submitted) return;
        if (q.type === 'multi') {
          var i = st.sel.indexOf(k);
          if (i >= 0) { st.sel.splice(i, 1); } else { st.sel.push(k); }
        } else {
          st.sel = [k];
        }
        msg = ''; render(); return;
      }

      case 'hint': {
        var sh = curS();
        if (!sh) return;
        sh.hint = !sh.hint;
        if (sh.hint) sh.hintUsed = true;
        render(); return;
      }

      case 'submit': submitCurrent(false); return;
      case 'cw': confirmWrong(v === '1'); return;

      case 'prev':
        if (session && session.idx > 0) {
          session.idx--; session.qStart = Date.now(); msg = '';
          if (session.mode === 'review') {
            // 回看已提交的题：不重复判定
          }
          render();
        }
        return;

      case 'next': {
        if (!session) return;
        var s2 = curS();
        if (!s2.submitted) return;
        if (session.mode === 'daily' && !s2.correct && !s2.confirmed) { msg = '请先选择是否加入错题本'; render(); return; }
        msg = '';
        if (session.idx < session.list.length - 1) { session.idx++; session.qStart = Date.now(); render(); }
        else { route = { name: 'result' }; render(); }
        return;
      }

      case 'quit':
        confirmBox = {
          title: '结束本次练习？', text: '未提交的题目不会计入记录。',
          onOk: function () { session = null; confirmBox = null; route = { name: 'home' }; renderDialog(); render(); }
        };
        renderDialog(); return;

      case 'again':
        if (session && session.mode === 'daily') { startSession('daily', shuffle(bankOf(settings.scope)).slice(0, settings.dailyCount)); }
        else { startSession('random', shuffle(bankOf(settings.scope)).slice(0, 30)); }
        return;

      case 'detail': {
        var q2 = BY_ID[t.getAttribute('data-id')];
        if (!q2) return;
        detail = { q: q2, sel: [], submitted: false, correct: false, practice: false, hint: false };
        msg = '';
        route = { name: 'detail' };
        window.scrollTo(0, 0); render(); return;
      }

      case 'd-mode':
        detail.practice = !detail.practice;
        detail.sel = []; detail.submitted = false; detail.correct = false; msg = '';
        render(); return;

      case 'd-submit': {
        if (!detail.sel.length) { msg = '请先选择答案'; render(); return; }
        detail.submitted = true;
        detail.correct = isCorrect(detail.q, detail.sel);
        pushRecord(detail.q, 'browse', detail.correct);
        // 注意：详情页作答不影响错题本（只有错题重刷才移出）
        msg = ''; render(); return;
      }

      case 'd-fav':
        setFav(detail.q.id, !favSet.has(detail.q.id));
        render(); return;

      case 'd-wrong': {
        var qid = detail.q.id;
        if (wrongMap[qid]) { removeWrong(qid); }
        else { addToWrong(detail.q, [], 'browse'); }
        render(); return;
      }

      case 'wf':
        wrongFilter = v || null;
        render(); return;

      case 'review-start': {
        var ids = Object.keys(wrongMap).map(function (id) { return BY_ID[id]; }).filter(Boolean);
        if (wrongFilter) { ids = ids.filter(function (q) { return q.source === wrongFilter; }); }
        if (!ids.length) return;
        startSession('review', ids);
        return;
      }

      case 'theme':
        settings.theme = v;
        save(LS.settings, settings);
        render(); return;

      case 'daily':
        settings.dailyCount = parseInt(v, 10) || 10;
        save(LS.settings, settings); render(); return;

      case 'pass':
        settings.passLine = parseInt(v, 10) || 80;
        save(LS.settings, settings); render(); return;

      case 'scope':
        settings.scope = v;
        save(LS.settings, settings); render(); return;

      case 'src':
        search.source = v; search.vol = 0;
        render(); return;

      case 'vol':
        search.vol = parseInt(v, 10) || 0;
        render(); return;

      case 'cat':
        search.cat = v;
        render(); return;

      case 'clear-records':
        confirmBox = {
          title: '清空刷题记录？', text: '将删除全部刷题记录与统计（题库、错题本、收藏不受影响）。此操作不可撤销。',
          onOk: function () { records = []; save(LS.records, records); confirmBox = null; renderDialog(); render(); }
        };
        renderDialog(); return;

      case 'clear-wrong':
        confirmBox = {
          title: '清空错题本？', text: '将删除错题本中的全部题目（刷题记录与收藏不受影响）。此操作不可撤销。',
          onOk: function () { wrongMap = {}; save(LS.wrong, wrongMap); confirmBox = null; renderDialog(); render(); }
        };
        renderDialog(); return;
    }
  });

  // 返回按钮
  $('#btn-back').addEventListener('click', function () {
    msg = '';
    if (route.name === 'detail') { route = { name: 'search' }; }
    else { route = { name: 'home' }; }
    window.scrollTo(0, 0);
    render();
  });

  // 确认对话框
  function renderDialog() {
    var root = $('#dialog-root');
    if (!confirmBox) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="dialog-mask"><div class="dialog">' +
      '<h3>' + esc(confirmBox.title) + '</h3>' +
      '<div style="font-size:14px;color:var(--muted)">' + esc(confirmBox.text) + '</div>' +
      '<div class="actions">' +
        '<button class="btn" id="dlg-cancel">取消</button>' +
        '<button class="btn btn-primary" id="dlg-ok">确认</button>' +
      '</div></div></div>';
    $('#dlg-cancel').onclick = function () { confirmBox = null; renderDialog(); };
    $('#dlg-ok').onclick = function () { confirmBox.onOk(); };
  }

  // ---------------- 启动 ----------------
  applyTheme();
  render();
})();
