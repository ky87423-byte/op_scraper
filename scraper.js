/**
 * 경쟁사 업소 데이터 스크래퍼
 * - 이미지: scraped_images\ 저장 → 서버 /images/imgs/ 업로드
 * - 데이터: scraped_data\output.sql INSERT 문 → phpMyAdmin import
 * - 요청 간격: 5~10초 랜덤 / 100건마다 30초 휴식
 */

const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');
const url_mod = require('url');

// ── 설정 ──────────────────────────────────────────────────────────
const CFG = {
    id:            'asdf87a',
    pw:            'asdf87a',
    baseUrl:       'https://opga037.com',
    listUrl:       'https://opga037.com/bbs/board.php?bo_table=op_partner_posting&cat=0&cat2=0&biz=0',
    delayMin:      2000,    // 2~5초 랜덤 딜레이 (차단 방지 + 스크래퍼 효율)
    delayMax:      5000,
    pauseEvery:    100,
    pauseDuration: 30000,
    imageDir:      path.join(__dirname, 'scraped_images'),
    dataDir:       path.join(__dirname, 'scraped_data'),
    userAgent:     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

[CFG.imageDir, CFG.dataDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const URLS_FILE  = path.join(CFG.dataDir, 'urls.json');
const DONE_FILE  = path.join(CFG.dataDir, 'done.txt');
const ERROR_FILE = path.join(CFG.dataDir, 'errors.txt');
const DATA_FILE  = path.join(CFG.dataDir, 'shops.json');
const LOG_FILE   = path.join(CFG.dataDir, 'scraper.log');

// ── 유틸 ───────────────────────────────────────────────────────────
const sleep  = ms => new Promise(r => setTimeout(r, ms));
const rand   = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const randMs = () => rand(CFG.delayMin, CFG.delayMax);
const log    = msg => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(LOG_FILE, line + '\n');
};
// JSON 저장 (PostgreSQL/Prisma import용)
function initData() {
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
}
function appendData(row) {
    const arr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    arr.push({ ...row, scrapedAt: new Date().toISOString() });
    fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
}

function loadDone() {
    if (!fs.existsSync(DONE_FILE)) return new Set();
    return new Set(fs.readFileSync(DONE_FILE,'utf8').split('\n').filter(Boolean));
}

// ── 이미지 다운로드 (Puppeteer 세션 이용 → 쿠키 자동 포함) ─────────
async function downloadImageWithPage(page, imgUrl, destPath) {
    if (fs.existsSync(destPath)) return true;
    try {
        const result = await page.evaluate(async (url) => {
            try {
                const res = await fetch(url, { credentials: 'include' });
                if (!res.ok) return { ok: false, status: res.status };
                const ab  = await res.arrayBuffer();
                return { ok: true, data: Array.from(new Uint8Array(ab)) };
            } catch(e) { return { ok: false, reason: e.message }; }
        }, imgUrl);
        if (!result.ok) return false;
        fs.writeFileSync(destPath, Buffer.from(result.data));
        return true;
    } catch(e) {
        return false;
    }
}

// ── 로그인 (단일 시도) ─────────────────────────────────────────────
async function loginOnce(page) {
    log('로그인 시도...');
    await page.goto('https://opga037.com/bbs/login.php', { waitUntil: 'networkidle2', timeout: 30000 });
    // networkidle2만으로는 폼 렌더가 보장되지 않을 수 있음 → 셀렉터 대기 필수
    await page.waitForSelector('#login_id', { timeout: 15000 });
    await sleep(800);

    const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.evaluate(() => {
        document.getElementById('login_id').value = 'asdf87a';
        document.getElementById('login_pw').value = 'asdf87a';
        const form = document.querySelector('form[name="flogin"]');
        if (typeof flogin_submit === 'function') {
            const r = flogin_submit(form);
            if (r) form.submit();
        } else { form.submit(); }
    });
    await nav.catch(() => {});
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    await sleep(1500);

    const ok = await page.evaluate(() => !!document.querySelector('a[href*="logout"]'));
    if (!ok) throw new Error('로그인 실패 — 로그아웃 링크 미발견');
    log('로그인 성공 → ' + page.url());
}

// ── 로그인 (지수 백오프 재시도) ────────────────────────────────────
async function login(page) {
    const waits = [0, 5000, 15000, 45000];  // 총 4회 시도
    let lastErr;
    for (let i = 0; i < waits.length; i++) {
        if (waits[i] > 0) {
            log(`로그인 재시도 ${i}/${waits.length - 1} — ${waits[i] / 1000}초 대기 후`);
            await sleep(waits[i]);
        }
        try {
            await loginOnce(page);
            return;
        } catch (e) {
            lastErr = e;
            log(`로그인 실패 ${i + 1}회차: ${e.message}`);
        }
    }
    throw new Error(`로그인 ${waits.length}회 모두 실패: ${lastErr?.message}`);
}

// ── 목록 수집 ─────────────────────────────────────────────────────
async function collectUrls(page) {
    log('업소 목록 수집 시작...');
    const items = [];
    const seenWrIds = new Set();
    let pageNum = 1;
    let emptyStreak = 0;

    while (true) {
        const listUrl = `${CFG.listUrl}&page=${pageNum}`;
        log(`  목록 p.${pageNum}: ${listUrl}`);
        await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(rand(3000, 5000));

        const links = await page.evaluate(() => {
            return [...document.querySelectorAll('a[href*="bo_table=op_partner_posting"][href*="wr_id"]')]
                .map(a => a.href)
                .filter(h => !h.includes('delete') && !h.includes('reply') && !h.includes('move'));
        });

        if (links.length === 0) { log(`  p.${pageNum}: 링크 없음 → 종료`); break; }

        let newCount = 0;
        for (const href of links) {
            try {
                const u = new url_mod.URL(href);
                const wrId = u.searchParams.get('wr_id');
                if (!wrId || seenWrIds.has(wrId)) continue;
                seenWrIds.add(wrId);
                newCount++;
                items.push({
                    wr_id:    wrId,
                    url:      `${CFG.baseUrl}/bbs/board.php?bo_table=op_partner_posting&wr_id=${wrId}`,
                    addrName: decodeURIComponent(u.searchParams.get('addrName') || ''),
                    bizName:  decodeURIComponent(u.searchParams.get('bizName')  || ''),
                    cat:      u.searchParams.get('cat')  || '',
                    cat2:     u.searchParams.get('cat2') || '',
                });
            } catch(e) {}
        }
        log(`  → 신규 ${newCount}개 (누적: ${items.length}개)`);

        // 3페이지 연속 신규 없으면 종료
        if (newCount === 0) {
            emptyStreak++;
            if (emptyStreak >= 3) { log('  3페이지 연속 신규 없음 → 종료'); break; }
        } else {
            emptyStreak = 0;
        }

        pageNum++;
        await sleep(rand(2000, 4000));
    }

    fs.writeFileSync(URLS_FILE, JSON.stringify(items, null, 2));
    log(`총 ${items.length}개 업소 URL 수집 완료`);
    return items;
}

// ── 상세 스크래핑 ─────────────────────────────────────────────────
async function scrapeDetail(page, item, idx) {
    await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(500);

    const raw = await page.evaluate(() => {
        const fullText = document.body.innerText;

        // 업소 제목: [지역-업소명] 패턴 (하이픈 필수 → 공지 [안내], [공지] 제외)
        const titleMatch = fullText.match(/(\[[가-힣a-zA-Z0-9\s★⭐❤*⚛️⭐⏩✅]+[-][가-힣a-zA-Z0-9\s★⭐❤*⚛️⭐⏩✅]+\][^\n]*)/u);
        const title = titleMatch ? titleMatch[1].trim() : '';

        // 글쓴이(업소명): 제목 줄 다음에 오는 짧은 닉네임
        const authorMatch = fullText.match(/\[[^\]]*-[^\]]*\][^\n]*\n[\s　]*([^\n\s][^\n]*?)\s{2,}\d/u);
        const author = authorMatch ? authorMatch[1].trim() : '';

        // 이미지: 같은 도메인 + 흔한 게시판 업로더 경로 (editor·file·cheditor·attach·gallery·upload)
        // 외부 광고/배너/스킨 이미지는 제외
        const imgUrls = [...new Set(
            [...document.querySelectorAll('img')]
                .map(i => i.src)
                .filter(s => {
                    if (!s) return false;
                    if (!/\.(jpg|jpeg|png|gif|webp)/i.test(s)) return false;
                    // 같은 도메인 또는 절대 경로 (외부 광고 제외)
                    if (!/^(https?:\/\/[^/]*opga037|\/)/.test(s)) return false;
                    // 흔한 게시판 업로드 경로
                    return /\/data\/(editor|file|cheditor|attach|gallery)\//.test(s)
                        || /\/upload\//.test(s);
                })
        )];

        // 전화번호
        const allPhones = [...new Set((fullText.match(/\b(0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})\b/g) || []))];
        const hphones   = allPhones.filter(p => p.replace(/\D/g,'').startsWith('010'));
        const phones    = allPhones.filter(p => !p.replace(/\D/g,'').startsWith('010'));

        // 텔레그램 (@아이디)
        const telegramMatch = fullText.match(/@([a-zA-Z0-9_]{4,})/);
        const telegram = telegramMatch ? '@' + telegramMatch[1] : '';

        // 조회수: 제목 다음 줄 "업소명   댓글수   조회수" 패턴에서 추출
        const hitMatch = fullText.match(/\[[^\]]*-[^\]]*\][^\n]*\n[\s　]*[^\n]+?\s{2,}(\d+)\s+([\d,]+)/u);
        const hit = hitMatch ? parseInt(hitMatch[2].replace(/,/g, '')) : 0;

        // 가격 (N만원)
        const priceMatch = fullText.match(/(\d{1,3})\s*만\s*원/);

        // 영업시간
        const timeMatch = fullText.match(/(\d{1,2}:\d{2})\s*[~\-]\s*(\d{1,2}:\d{2})/);

        return {
            title,
            author,
            imgUrls: imgUrls.slice(0, 40),
            phone:    phones[0]  || hphones[0] || allPhones[0] || '',
            hphone:   hphones[0] || '',
            telegram,
            hit,
            price:    priceMatch ? parseInt(priceMatch[1]) * 10000 : 0,
            time1:    timeMatch  ? timeMatch[1] : '',
            time2:    timeMatch  ? timeMatch[2] : '',
            timeFull: fullText.includes('24시') ? 1 : 0,
        };
    });

    // 제목에서 업소명/지역 파싱
    const bracketContent = (raw.title.match(/^\[([^\]]+)\]/) || [])[1] || '';
    const dashIdx   = bracketContent.indexOf('-');
    const titleArea = item.addrName || (dashIdx > -1 ? bracketContent.substring(0, dashIdx).trim() : '');
    const company   = raw.author    || (dashIdx > -1 ? bracketContent.substring(dashIdx + 1).trim() : bracketContent) || item.bizName;
    const area      = titleArea ? `${titleArea},` : '';
    const subject   = raw.title.replace(/^\[[^\]]+\]\s*/, '').substring(0, 200);

    // 이미지 다운로드 (Puppeteer fetch)
    const savedPaths = [];
    for (let i = 0; i < raw.imgUrls.length; i++) {
        const imgUrl = raw.imgUrls[i];
        const ext    = (imgUrl.match(/\.(gif|jpg|jpeg|png|webp)/i) || ['.jpg'])[0].toLowerCase();
        const fname  = `${item.wr_id}_${i + 1}${ext}`;
        const dest   = path.join(CFG.imageDir, fname);
        const ok     = await downloadImageWithPage(page, imgUrl, dest);
        if (ok) savedPaths.push(`/images/imgs/${fname}`);
    }

    // 내용 HTML (이미지 태그)
    const content = savedPaths.map(p => `<img src="${p}">`).join('\n');

    const row = {
        externalId: parseInt(item.wr_id, 10),  // 스마트 upsert 키 (외부 사이트 wr_id)
        company,
        subject,
        content,
        area,
        category:  item.cat  || '',
        category2: item.cat2 || '',
        phone:     raw.phone,
        hphone:    raw.hphone,
        telegram:  raw.telegram,
        hit:       raw.hit,
        price:     raw.price,
        mainPhoto: savedPaths[0] || '',
        photos:    savedPaths.slice(1).join(','),
        time1:     raw.time1,
        time2:     raw.time2,
        timeFull:  raw.timeFull,
    };

    appendData(row);
    log(`[${idx}] ${row.company} | 지역:${area} | 이미지:${savedPaths.length}개 | ${item.url}`);
    return row;
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
    initData();
    log('=== 스크래퍼 시작 ===');

    // 헤드리스 모드 감지 회피 — false 로 두면 실제 Chrome 창이 뜨지만 bot 감지 통과율 ↑
    // 환경변수 HEADLESS=true 로 강제 헤드리스 가능 (서버 환경 등)
    const isHeadless = process.env.HEADLESS === 'true';
    const browser = await puppeteer.launch({
        headless: isHeadless,
        protocolTimeout: 60000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-web-security',
            '--start-maximized',
        ],
        defaultViewport: null,   // 창 크기에 맞춰 자동
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(CFG.userAgent);
        await page.setViewport({ width: 1366, height: 768 });
        await page.evaluateOnNewDocument(() => {
            // navigator.webdriver 숨김
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            // plugins/languages 정상 브라우저처럼
            Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
            // chrome 객체 존재 (헤드리스에서는 없음)
            // @ts-ignore
            window.chrome = { runtime: {} };
            // permissions API 정상 응답
            const origQuery = window.navigator.permissions?.query;
            if (origQuery) {
                window.navigator.permissions.query = (params) =>
                    params.name === 'notifications'
                        ? Promise.resolve({ state: Notification.permission })
                        : origQuery(params);
            }
        });
        // ── 다이얼로그 핸들러: "로그인 필요" 메시지 감지 시 재로그인 플래그 설정 ──
        let needRelogin = false;
        page.on('dialog', async d => {
            const msg = d.message();
            log(`[Dialog] ${msg.substring(0,80)}`);
            if (msg.includes('로그인이 필요') || msg.includes('로그인이 필')) {
                needRelogin = true;
            }
            await d.accept();
        });

        // 1. 로그인
        await login(page);

        // 2. URL 목록 (기존 파일 있으면 재사용)
        let items;
        if (fs.existsSync(URLS_FILE)) {
            items = JSON.parse(fs.readFileSync(URLS_FILE,'utf8'));
            log(`기존 URL 목록 재사용: ${items.length}개`);
        } else {
            items = await collectUrls(page);
        }

        // 3. 상세 스크래핑
        const done = loadDone();
        // 에러로 기록된 wr_id 도 main loop 에서는 건너뜀 — retry-errors.js 로 별도 처리
        const errored = fs.existsSync(ERROR_FILE)
            ? new Set(fs.readFileSync(ERROR_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean))
            : new Set();
        let count = 0;
        let consecutiveDialogErrors = 0;   // 다이얼로그-기반 timeout 연속 횟수

        log(`\n상세 스크래핑 시작 (총 ${items.length}개, 완료 ${done.size} + 에러 ${errored.size} 스킵)`);

        // 재로그인 쿨다운 (사이트가 차단 중일 수 있어 무한 재시도 방지)
        let lastReloginAttempt = 0;
        const RELOGIN_COOLDOWN_MS = 5 * 60_000; // 5분

        for (const item of items) {
            if (done.has(item.wr_id) || errored.has(item.wr_id)) continue;
            count++;

            // 연속 3회 이상 다이얼로그-timeout 발생 시에만 진짜 세션 만료로 간주
            // (개별 글이 삭제된 경우 한두 번 timeout은 정상 — 재로그인 불필요)
            if (needRelogin && consecutiveDialogErrors >= 3) {
                needRelogin = false;
                consecutiveDialogErrors = 0;
                const since = Date.now() - lastReloginAttempt;
                if (since < RELOGIN_COOLDOWN_MS) {
                    log(`⏳ 재로그인 쿨다운 중 (${Math.round(since/1000)}/${RELOGIN_COOLDOWN_MS/1000}초) — 스킵`);
                } else {
                    lastReloginAttempt = Date.now();
                    log(`🔐 연속 ${consecutiveDialogErrors}회 다이얼로그 → 진짜 세션 만료로 판단, 재로그인`);
                    try {
                        const cookies = await page.cookies();
                        if (cookies.length > 0) await page.deleteCookie(...cookies);
                        await login(page);
                    } catch (e) {
                        log(`즉시 재로그인 실패: ${e.message} — ${RELOGIN_COOLDOWN_MS/60000}분 후 자동 재시도`);
                    }
                }
            } else if (needRelogin) {
                needRelogin = false;  // 연속 카운트 미달 — 그냥 다음 글로
            }

            // 100건마다 장기 휴식 + 세션 체크
            if (count % CFG.pauseEvery === 0) {
                log(`[${count}건] ${CFG.pauseDuration/1000}초 휴식...`);
                await sleep(CFG.pauseDuration);
                try {
                    await page.goto(CFG.baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(()=>{});
                    const still = await page.evaluate(() => !!document.querySelector('a[href*="logout"]'));
                    if (!still) { log('세션 만료 → 재로그인'); await login(page); }
                } catch (e) {
                    log(`재로그인 체크 실패 — 계속 진행: ${e.message}`);
                }
            }

            try {
                await scrapeDetail(page, item, count);
                fs.appendFileSync(DONE_FILE, item.wr_id + '\n');
                consecutiveDialogErrors = 0;   // 성공 시 리셋
            } catch(e) {
                log(`[오류] wr_id=${item.wr_id}: ${e.message}`);
                fs.appendFileSync(ERROR_FILE, item.wr_id + '\n');
                // 다이얼로그-timeout 패턴이면 연속 카운트 증가
                if (needRelogin || /Navigation timeout/i.test(e.message)) {
                    consecutiveDialogErrors++;
                } else {
                    consecutiveDialogErrors = 0;
                }
            }

            // 5~10초 랜덤 대기
            const wait = randMs();
            log(`  → ${(wait/1000).toFixed(1)}초 대기`);
            await sleep(wait);
        }

        log(`\n=== 완료 ===`);
        log(`처리: ${count}개 | 이미지: ${CFG.imageDir} | 데이터: ${DATA_FILE}`);

    } catch(e) {
        log(`치명적 오류: ${e.message}`);
        console.error(e.stack);
    } finally {
        await browser.close();
    }
}

// 다른 스크립트(retry-errors.js)에서 login/scrapeDetail을 재사용할 수 있도록 export
module.exports = { login, loginOnce, scrapeDetail, initData, loadDone, CFG };

// 직접 실행 시에만 main() 동작 (require될 때는 실행 안 됨)
if (require.main === module) {
    main();
}
