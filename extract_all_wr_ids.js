/**
 * op_partner_coupon 게시판에서 op_partner_posting wr_id 전체 수집
 * → 이후 scraper.js가 이 목록을 사용해 상세 스크래핑
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DATA_DIR  = path.join(__dirname, 'scraped_data');
const URLS_FILE = path.join(DATA_DIR, 'urls.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        page.on('dialog', async d => { await d.accept(); });

        // 로그인
        await page.goto('https://opga037.com/bbs/login.php', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(1500);
        const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.evaluate(() => {
            document.getElementById('login_id').value = 'asdf87a';
            document.getElementById('login_pw').value = 'asdf87a';
            const form = document.querySelector('form[name="flogin"]');
            const r = flogin_submit(form); if (r) form.submit();
        });
        await nav.catch(() => {});
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
        await sleep(2000);
        console.log('로그인됨');

        const allItems = [];
        const seenWrIds = new Set();

        // op_partner_coupon 페이지 순회
        let pageNum = 1;
        let emptyPages = 0;

        while (true) {
            const url = `https://opga037.com/bbs/board.php?bo_table=op_partner_coupon&page=${pageNum}`;
            console.log(`\n=== p.${pageNum} ===`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
            await sleep(rand(2000, 4000));

            const { items, hasMore } = await page.evaluate(() => {
                // op_partner_posting 링크만 필터
                const links = [...document.querySelectorAll('a[href*="bo_table=op_partner_posting"][href*="wr_id"]')]
                    .filter(a => !a.href.includes('delete') && !a.href.includes('reply') && !a.href.includes('move'));

                const items = links.map(a => {
                    try {
                        const u = new URL(a.href);
                        const wrId = u.searchParams.get('wr_id');
                        const addrName = decodeURIComponent(u.searchParams.get('addrName') || '');
                        const bizName  = decodeURIComponent(u.searchParams.get('bizName') || '');
                        const cat  = u.searchParams.get('cat') || '';
                        const cat2 = u.searchParams.get('cat2') || '';
                        return wrId ? { wr_id: wrId, addrName, bizName, cat, cat2,
                            url: `https://opga037.com/bbs/board.php?bo_table=op_partner_posting&wr_id=${wrId}` } : null;
                    } catch(e) { return null; }
                }).filter(Boolean);

                // 다음 페이지 링크 확인
                const pageNums = [...document.querySelectorAll('a[href*="page="]')]
                    .map(a => { try { return parseInt(new URL(a.href).searchParams.get('page')); } catch(e) { return 0; } })
                    .filter(n => n > 0);
                const maxPage = pageNums.length ? Math.max(...pageNums) : 0;
                const hasMore = maxPage > 0;

                return { items, hasMore, maxPage };
            });

            // 새 wr_id 추가
            let newCount = 0;
            for (const item of items) {
                if (!seenWrIds.has(item.wr_id)) {
                    seenWrIds.add(item.wr_id);
                    allItems.push(item);
                    newCount++;
                }
            }

            console.log(`  op_posting 링크: ${items.length}개 | 신규: ${newCount}개 | 누적: ${allItems.length}개`);

            if (newCount === 0) {
                emptyPages++;
                console.log(`  새 항목 없음 (${emptyPages}번째)`);
                if (emptyPages >= 3) { console.log('  3페이지 연속 신규 없음 → 종료'); break; }
            } else {
                emptyPages = 0;
            }

            // 다음 페이지 없으면 종료
            const { hasMore: more } = await page.evaluate(() => {
                const pageNums = [...document.querySelectorAll('a[href*="page="]')]
                    .map(a => { try { return parseInt(new URL(a.href).searchParams.get('page')); } catch(e) { return 0; } })
                    .filter(n => n > 0);
                return { hasMore: pageNums.some(n => n > window._currentPage) };
            });

            // 간단히: 최대 200 페이지까지 시도
            if (pageNum >= 200) { console.log('200페이지 도달 → 종료'); break; }
            pageNum++;

            await sleep(rand(3000, 6000));
        }

        console.log(`\n=== 완료: 총 ${allItems.length}개 업소 URL 수집 ===`);
        fs.writeFileSync(URLS_FILE, JSON.stringify(allItems, null, 2));
        console.log('저장:', URLS_FILE);

        // addrName 분포 출력
        const addrCount = {};
        for (const item of allItems) {
            addrCount[item.addrName] = (addrCount[item.addrName] || 0) + 1;
        }
        console.log('\n지역별 업소 수:');
        Object.entries(addrCount).sort((a, b) => b[1] - a[1]).forEach(([addr, cnt]) =>
            console.log(`  ${addr || '(없음)'}: ${cnt}개`)
        );

    } catch(e) {
        console.error('오류:', e.message, '\n', e.stack);
    } finally {
        await browser.close();
    }
})();

function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
