/**
 * errors.txt에 기록된 wr_id만 재시도.
 *
 * 사용법:
 *   node retry-errors.js
 *
 * 흐름:
 *   1. errors.txt에서 wr_id 목록 로드
 *   2. urls.json에서 해당 wr_id의 메타데이터(url, addrName 등) 조회
 *   3. 로그인 후 각 항목 scrapeDetail 재시도
 *   4. 성공 → done.txt에 추가 + errors.txt에서 제거
 *   5. 실패 → errors.txt에 유지 + 별도 로그(retry-errors.log)
 */

const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');
const { login, scrapeDetail, initData, CFG } = require('./scraper');

const ERRORS_FILE = path.join(CFG.dataDir, 'errors.txt');
const DONE_FILE   = path.join(CFG.dataDir, 'done.txt');
const URLS_FILE   = path.join(CFG.dataDir, 'urls.json');
const RETRY_LOG   = path.join(CFG.dataDir, 'retry-errors.log');

const rlog = msg => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(RETRY_LOG, line + '\n');
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

async function main() {
    initData();
    rlog('=== 에러 재시도 시작 ===');

    // 1. 에러 wr_id 로드
    if (!fs.existsSync(ERRORS_FILE)) {
        rlog('errors.txt 없음 → 종료');
        return;
    }
    const errorIds = [...new Set(
        fs.readFileSync(ERRORS_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    )];
    rlog(`재시도 대상 wr_id: ${errorIds.length}개 (${errorIds.join(', ')})`);

    if (errorIds.length === 0) { rlog('재시도할 항목 없음'); return; }

    // 2. urls.json에서 메타데이터 매칭
    const urls = JSON.parse(fs.readFileSync(URLS_FILE, 'utf8'));
    const urlMap = new Map(urls.map(u => [u.wr_id, u]));
    const items  = errorIds
        .map(id => urlMap.get(id))
        .filter(Boolean);

    if (items.length < errorIds.length) {
        const missing = errorIds.filter(id => !urlMap.has(id));
        rlog(`⚠ urls.json에 없는 wr_id ${missing.length}개: ${missing.join(', ')}`);
    }

    // 3. 브라우저 + 로그인 (scraper.js 와 동일한 bot 감지 회피 설정)
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
        defaultViewport: null,
    });

    const succeeded = [];
    const stillFailed = [];

    try {
        const page = await browser.newPage();
        await page.setUserAgent(CFG.userAgent);
        await page.setViewport({ width: 1366, height: 768 });
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        page.on('dialog', async d => { rlog(`[Dialog] ${d.message().substring(0, 80)}`); await d.accept(); });

        await login(page);

        // 4. 각 아이템 재시도
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            rlog(`[${i + 1}/${items.length}] wr_id=${item.wr_id} 재시도`);
            try {
                await scrapeDetail(page, item, i + 1);
                fs.appendFileSync(DONE_FILE, item.wr_id + '\n');
                succeeded.push(item.wr_id);
                rlog(`  ✅ 성공`);
            } catch (e) {
                stillFailed.push({ wr_id: item.wr_id, reason: e.message });
                rlog(`  ❌ 실패: ${e.message}`);
            }
            if (i < items.length - 1) {
                const wait = rand(5000, 10000);
                rlog(`  → ${(wait / 1000).toFixed(1)}초 대기`);
                await sleep(wait);
            }
        }
    } catch (e) {
        rlog(`치명적 오류: ${e.message}`);
        console.error(e.stack);
    } finally {
        await browser.close();
    }

    // 5. errors.txt 갱신 — 성공한 wr_id 제거, 실패한 것만 남김
    const remaining = errorIds.filter(id => !succeeded.includes(id));
    fs.writeFileSync(ERRORS_FILE, remaining.length ? remaining.join('\n') + '\n' : '');

    rlog('\n=== 재시도 완료 ===');
    rlog(`성공: ${succeeded.length}개 | 실패: ${stillFailed.length}개`);
    if (stillFailed.length) {
        rlog('여전히 실패한 항목:');
        stillFailed.forEach(f => rlog(`  · wr_id=${f.wr_id} — ${f.reason}`));
        rlog('→ 해당 게시물이 삭제됐거나 권한 문제일 수 있음. 수동 확인 권장.');
    }
}

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}
