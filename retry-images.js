/**
 * 이미지 없는 shops.json 항목만 재스크랩.
 *
 * 흐름:
 *   1. scraper.log 에서 "이미지:0개" 줄 → (wr_id, company, area) 추출
 *   2. shops.json 의 매칭 entry 식별 (company+area 1차 키)
 *   3. 로그인 후 각 wr_id 페이지 재방문 → 새 정규식으로 이미지 추출
 *   4. 이미지 발견 시 mainPhoto/photos 업데이트 + externalId 백필 + lastScrapedAt 갱신
 *   5. 매 100건마다 shops.json 디스크에 flush (장시간 작업 안전)
 *
 * 실행: node retry-images.js
 */

const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');
const url_mod = require('url');
const { login, scrapeDetail, initData, CFG } = require('./scraper');

const SHOPS_PATH = path.join(CFG.dataDir, 'shops.json');
const LOG_PATH   = path.join(CFG.dataDir, 'scraper.log');
const RETRY_LOG  = path.join(CFG.dataDir, 'retry-images.log');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const rlog  = msg => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(RETRY_LOG, line + '\n');
};

async function main() {
    initData();
    rlog('━'.repeat(60));
    rlog('🖼  retry-images: 이미지 0개 shop 재스크랩');
    rlog('━'.repeat(60));

    // 1) scraper.log 에서 이미지 0개 wr_id 추출
    if (!fs.existsSync(LOG_PATH)) throw new Error('scraper.log 없음');
    const log = fs.readFileSync(LOG_PATH, 'utf8');
    const lineRe = /\[(\d+)\]\s+(.+?)\s+\|\s+지역:(.+?)\s+\|\s+이미지:0개\s+\|\s+(https:\/\/[^\s]+wr_id=(\d+))/g;

    const targets = [];
    const seenWrIds = new Set();
    let m;
    while ((m = lineRe.exec(log)) !== null) {
        const [, , company, area, url, wrId] = m;
        if (seenWrIds.has(wrId)) continue;
        seenWrIds.add(wrId);
        targets.push({
            wr_id:    wrId,
            url,
            company:  company.trim(),
            area:     area.trim() + (area.endsWith(',') ? '' : ','),
            cat:      '',
            cat2:     '',
            addrName: '',
            bizName:  '',
        });
    }
    rlog(`이미지 0개 후보: ${targets.length}건 (중복 wr_id 제거)`);

    // 2) shops.json 에서 실제로 mainPhoto 가 비어있는 entry 만 (이미 갱신된 건 스킵)
    const shops = JSON.parse(fs.readFileSync(SHOPS_PATH, 'utf8'));
    const shopIndex = new Map();   // key: `${company}|${area}` → array of indices
    shops.forEach((s, i) => {
        const key = `${s.company}|${s.area || ''}`;
        if (!shopIndex.has(key)) shopIndex.set(key, []);
        shopIndex.get(key).push(i);
    });

    const queue = targets.filter(t => {
        const key = `${t.company}|${t.area}`;
        const idxs = shopIndex.get(key) || [];
        return idxs.some(i => !shops[i].mainPhoto || shops[i].mainPhoto === '');
    });
    rlog(`실제 재스크랩 대상 (mainPhoto 비어있음): ${queue.length}건`);

    if (queue.length === 0) {
        rlog('할 일 없음 — 종료');
        return;
    }

    // 3) 브라우저
    const isHeadless = process.env.HEADLESS === 'true';
    const browser = await puppeteer.launch({
        headless: isHeadless,
        protocolTimeout: 60000,
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-web-security', '--start-maximized',
        ],
        defaultViewport: null,
    });

    let updated = 0, stillEmpty = 0, failed = 0;

    try {
        const page = await browser.newPage();
        await page.setUserAgent(CFG.userAgent);
        await page.setViewport({ width: 1366, height: 768 });
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
            window.chrome = { runtime: {} };
        });
        page.on('dialog', async d => { rlog(`[Dialog] ${d.message().substring(0, 80)}`); await d.accept(); });

        await login(page);

        for (let i = 0; i < queue.length; i++) {
            const item = queue[i];
            rlog(`[${i + 1}/${queue.length}] wr_id=${item.wr_id} "${item.company}"`);

            try {
                const newRow = await scrapeDetail(page, item, i + 1);
                if (!newRow) { failed++; continue; }

                // shops.json 매칭 — 1차: scraper.log 원본 (item) 키 (옛 shops.json 에 저장된 그 값)
                //                  2차: 새 newRow 키 fallback (사이트가 그 사이 변경된 케이스)
                let idxs = shopIndex.get(`${item.company}|${item.area}`) || [];
                if (idxs.length === 0) {
                    idxs = shopIndex.get(`${newRow.company}|${newRow.area}`) || [];
                }
                let touched = false;

                for (const idx of idxs) {
                    if (shops[idx].mainPhoto && shops[idx].mainPhoto !== '') continue;
                    if (newRow.mainPhoto && newRow.mainPhoto !== '') {
                        shops[idx].mainPhoto = newRow.mainPhoto;
                        shops[idx].photos    = newRow.photos;
                        shops[idx].content   = newRow.content;
                        shops[idx].externalId    = newRow.externalId;
                        shops[idx].lastScrapedAt = new Date().toISOString();
                        touched = true;
                        updated++;
                        const photoCnt = 1 + (newRow.photos || '').split(',').filter(Boolean).length;
                        rlog(`   ✅ 업데이트 (이미지 ${photoCnt}개)`);
                        break;
                    }
                }
                if (!touched) {
                    stillEmpty++;
                    if (newRow.mainPhoto && newRow.mainPhoto !== '') {
                        // 이미지는 있는데 매칭 실패 — 디버그 정보 출력
                        rlog(`   ⚠ 매칭 실패 (이미지 ${1 + (newRow.photos || '').split(',').filter(Boolean).length}개): item="${item.company}|${item.area}" vs new="${newRow.company}|${newRow.area}" idxs=${idxs.length}`);
                    } else {
                        rlog(`   ⚪ 여전히 이미지 없음 (원본 글에 진짜 없는 듯)`);
                    }
                }
            } catch (e) {
                failed++;
                rlog(`   ❌ 실패: ${e.message}`);
            }

            // 100건마다 디스크 flush + 진행 안내
            if ((i + 1) % 100 === 0) {
                fs.writeFileSync(SHOPS_PATH, JSON.stringify(shops, null, 2));
                rlog(`💾 [${i + 1}건] shops.json flush (updated=${updated}, stillEmpty=${stillEmpty}, failed=${failed})`);
            }

            // 2~5초 랜덤 대기
            await sleep(rand(CFG.delayMin, CFG.delayMax));
        }

        // 최종 flush
        fs.writeFileSync(SHOPS_PATH, JSON.stringify(shops, null, 2));
    } catch (e) {
        rlog(`치명적 오류: ${e.message}`);
        console.error(e.stack);
    } finally {
        await browser.close();
    }

    rlog('');
    rlog('━'.repeat(60));
    rlog('🎉 완료');
    rlog(`   ✅ 이미지 갱신: ${updated}건`);
    rlog(`   ⚪ 진짜 이미지 없음: ${stillEmpty}건`);
    rlog(`   ❌ 실패: ${failed}건`);
    rlog('━'.repeat(60));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
