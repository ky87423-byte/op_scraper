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
        console.log('로그인:', page.url());

        // op 게시판 1페이지
        await page.goto('https://opga037.com/bbs/board.php?bo_table=op&page=1', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);

        const info = await page.evaluate(() => {
            const text = document.body.innerText;

            // 총 건수
            const totalMatch = text.match(/총\s*([\d,]+)\s*건/) || text.match(/([\d,]+)\s*건/);
            const total = totalMatch ? totalMatch[1] : '?';

            // 업소 링크 수
            const wrLinks = [...document.querySelectorAll('a[href*="bo_table=op"][href*="wr_id"]')]
                .filter(a => !a.href.includes('delete') && !a.href.includes('reply') && !a.href.includes('move'));

            // 페이지 링크들 (다음 페이지 확인)
            const pageLinks = [...document.querySelectorAll('a[href*="page="]')]
                .map(a => ({ text: a.textContent.trim(), href: a.href }));

            // 마지막 페이지 번호 찾기
            const pageNums = pageLinks
                .map(p => { try { return parseInt(new URL(p.href).searchParams.get('page')); } catch(e) { return 0; } })
                .filter(n => n > 0);
            const maxPage = pageNums.length ? Math.max(...pageNums) : '?';

            return {
                total,
                linkCount: wrLinks.length,
                maxPage,
                pageLinks: pageLinks.slice(0, 10),
                sampleLinks: wrLinks.slice(0, 5).map(a => ({ text: a.textContent.trim().substring(0, 40), href: a.href })),
                currentUrl: location.href,
                title: document.title,
            };
        });

        console.log('\n=== op 게시판 정보 ===');
        console.log('URL:', info.currentUrl);
        console.log('제목:', info.title);
        console.log('총 건수:', info.total);
        console.log('이 페이지 링크 수:', info.linkCount);
        console.log('최대 페이지 번호:', info.maxPage);
        console.log('페이지 링크들:', info.pageLinks);
        console.log('샘플 업소:', info.sampleLinks);

        // 페이지네이션 HTML 구조 확인
        const paginationHtml = await page.evaluate(() => {
            const pag = document.querySelector('.pagination, .pg_wrap, .pager, nav[aria-label], .at-pager');
            return pag ? pag.outerHTML.substring(0, 500) : '페이지네이션 못찾음';
        });
        console.log('\n페이지네이션 HTML:', paginationHtml);

        // 2페이지도 확인
        await page.goto('https://opga037.com/bbs/board.php?bo_table=op&page=2', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(1500);
        const page2 = await page.evaluate(() => {
            const wrLinks = [...document.querySelectorAll('a[href*="bo_table=op"][href*="wr_id"]')]
                .filter(a => !a.href.includes('delete') && !a.href.includes('reply'));
            return {
                url: location.href,
                linkCount: wrLinks.length,
                sample: wrLinks.slice(0, 3).map(a => a.textContent.trim().substring(0, 40)),
            };
        });
        console.log('\n=== 2페이지 ===');
        console.log('URL:', page2.url);
        console.log('링크 수:', page2.linkCount);
        console.log('샘플:', page2.sample);

    } catch(e) {
        console.error('오류:', e.message, e.stack);
    } finally {
        await browser.close();
    }
})();
