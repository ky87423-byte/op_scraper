/**
 * op_partner_coupon 게시판 구조 확인 + 전체 업소 목록 접근 방법 탐색
 */
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
        await sleep(1500);
        console.log('로그인됨');

        // ① op_partner_coupon 구조 확인
        await page.goto('https://opga037.com/bbs/board.php?bo_table=op_partner_coupon', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);

        const couponInfo = await page.evaluate(() => {
            const links = [...document.querySelectorAll('a[href*="wr_id"]')]
                .filter(a => !a.href.includes('delete') && !a.href.includes('reply'));
            const wr_ids = [...new Set(links.map(a => {
                try { return new URL(a.href).searchParams.get('wr_id'); }
                catch(e) { return null; }
            }).filter(Boolean))];

            const pageNums = [...document.querySelectorAll('a[href*="page="]')]
                .map(a => { try { return parseInt(new URL(a.href).searchParams.get('page')); } catch(e) { return 0; } })
                .filter(n => n > 0);

            // bo_table 추출
            const boTables = [...new Set(links.map(a => {
                try { return new URL(a.href).searchParams.get('bo_table'); }
                catch(e) { return ''; }
            }).filter(Boolean))];

            return {
                totalLinks: links.length,
                uniqueWrIds: wr_ids.length,
                maxPage: pageNums.length ? Math.max(...pageNums) : 1,
                boTables,
                sampleLinks: links.slice(0, 5).map(a => ({ text: a.textContent.trim().substring(0, 40), href: a.href.substring(0, 120) })),
                title: document.title,
            };
        });
        console.log('\n=== op_partner_coupon ===');
        console.log('제목:', couponInfo.title);
        console.log('총 링크:', couponInfo.totalLinks, '| 고유 wr_id:', couponInfo.uniqueWrIds, '| maxPage:', couponInfo.maxPage);
        console.log('bo_tables:', couponInfo.boTables);
        couponInfo.sampleLinks.forEach(l => console.log(' ', l.text, '→', l.href));

        // ② op_partner_coupon 2페이지
        await page.goto('https://opga037.com/bbs/board.php?bo_table=op_partner_coupon&page=2', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);
        const page2 = await page.evaluate(() => {
            const links = [...document.querySelectorAll('a[href*="wr_id"]')]
                .filter(a => !a.href.includes('delete') && !a.href.includes('reply'));
            const wr_ids = [...new Set(links.map(a => {
                try { return new URL(a.href).searchParams.get('wr_id'); }
                catch(e) { return null; }
            }).filter(Boolean))];
            return { uniqueWrIds: wr_ids.length, firstId: wr_ids[0], lastId: wr_ids[wr_ids.length-1] };
        });
        console.log('\n=== op_partner_coupon 2페이지 ===');
        console.log('고유 wr_id:', page2.uniqueWrIds, '| 첫ID:', page2.firstId, '| 끝ID:', page2.lastId);

        // ③ op_partner_posting에서 _stx=없이 검색 (전체 업소)
        console.log('\n=== 전체 업소 검색 시도 ===');
        const searchUrls = [
            'https://opga037.com/bbs/board.php?bo_table=op_partner_posting&sfl=wr_subject&stx=&page=1',
            'https://opga037.com/bbs/board.php?bo_table=op_partner_posting&fin=Y&page=1',
            'https://opga037.com/bbs/board.php?bo_table=op_partner_posting&fin=Y&page=2',
            'https://opga037.com/bbs/board.php?bo_table=op_partner_posting&fin=Y&page=100',
        ];

        for (const url of searchUrls) {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
            await sleep(1500);
            const r = await page.evaluate(() => {
                const links = [...document.querySelectorAll('a[href*="wr_id"]')]
                    .filter(a => !a.href.includes('delete') && !a.href.includes('reply'));
                const wr_ids = [...new Set(links.map(a => {
                    try { return new URL(a.href).searchParams.get('wr_id'); }
                    catch(e) { return null; }
                }).filter(Boolean))];
                const pageNums = [...document.querySelectorAll('a[href*="page="]')]
                    .map(a => { try { return parseInt(new URL(a.href).searchParams.get('page')); } catch(e) { return 0; } })
                    .filter(n => n > 0);
                return { uniqueWrIds: wr_ids.length, maxPage: pageNums.length ? Math.max(...pageNums) : 1, firstId: wr_ids[0], currentUrl: location.href };
            });
            console.log(`  URL: ${url.substring(50)}`);
            console.log(`  → unique_wr=${r.uniqueWrIds} maxPage=${r.maxPage} firstId=${r.firstId} realUrl=${r.currentUrl.substring(50)}`);
        }

        // ④ addrName 전체 목록 조회 (at-lnb 사이드바)
        await page.goto('https://opga037.com/bbs/board.php?bo_table=op_partner_posting', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);
        const sidebar = await page.evaluate(() => {
            const lnb = document.querySelector('.at-lnb, .at-side, [class*="lnb"]');
            if (!lnb) return 'LNB 없음';
            return lnb.innerHTML.substring(0, 2000);
        });
        console.log('\n=== at-lnb 사이드바 HTML ===');
        console.log(sidebar.substring(0, 1500));

    } catch(e) {
        console.error('오류:', e.message, '\n', e.stack);
    } finally {
        await browser.close();
    }
})();
