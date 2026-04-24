/**
 * 사이트 구조 탐색 - 어떤 게시판에 업소 목록이 있는지 확인
 */
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        headless: false, // 눈으로 보기 위해 headless 끔
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });
        page.on('dialog', async d => { console.log('[Dialog]', d.message().substring(0, 80)); await d.accept(); });

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
        console.log('로그인됨:', page.url());

        // 메인 페이지 탐색
        await page.goto('https://opga037.com/', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);

        const info = await page.evaluate(() => {
            // 모든 href 링크 수집
            const links = [...document.querySelectorAll('a[href]')]
                .map(a => a.href)
                .filter(h => h.includes('bo_table') || h.includes('board.php'));

            const boards = [...new Set(links.map(h => {
                try {
                    const u = new URL(h);
                    return u.searchParams.get('bo_table') || '';
                } catch(e) { return ''; }
            }))].filter(Boolean);

            // 페이지 제목과 주요 텍스트
            const title = document.title;
            const navTexts = [...document.querySelectorAll('nav a, .menu a, #menu a, .gnb a, .lnb a')]
                .map(a => ({ text: a.textContent.trim(), href: a.href }))
                .filter(x => x.text && x.href.includes('opga037'));

            return { boards, title, navTexts, url: location.href };
        });

        console.log('\n=== 메인 페이지 ===');
        console.log('제목:', info.title);
        console.log('게시판 목록:', info.boards);
        console.log('네비 링크:', info.navTexts.slice(0, 20));

        // 각 게시판 첫 페이지에 업소 링크가 몇 개 있는지 확인
        const boardsToCheck = [...new Set([...info.boards, 'op', 'op_list', 'op_info', 'bbs'])];
        console.log('\n=== 게시판별 업소 링크 수 확인 ===');

        for (const bo of boardsToCheck) {
            try {
                const url = `https://opga037.com/bbs/board.php?bo_table=${bo}`;
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
                await sleep(1000);

                const result = await page.evaluate((bo) => {
                    const wrLinks = [...document.querySelectorAll(`a[href*="bo_table=${bo}"][href*="wr_id"]`)]
                        .filter(a => !a.href.includes('delete') && !a.href.includes('reply'));

                    // 전체 게시글 수 (페이지네이션 정보)
                    const totalText = document.body.innerText.match(/총\s*([\d,]+)\s*건/);
                    const total = totalText ? totalText[1] : '?';

                    return {
                        count: wrLinks.length,
                        total,
                        title: document.title.substring(0, 50),
                        sample: wrLinks.slice(0, 2).map(a => a.textContent.trim().substring(0, 30))
                    };
                }, bo);

                if (result.count > 0) {
                    console.log(`✓ ${bo}: ${result.count}개 링크 | 총 ${result.total}건 | "${result.title}"`);
                    console.log(`  샘플: ${result.sample.join(' / ')}`);
                }
            } catch(e) {
                // skip
            }
        }

        // 현재 URL 구조 추가 탐색: 메인에서 업소 링크 직접 찾기
        await page.goto('https://opga037.com/', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);

        const mainLinks = await page.evaluate(() => {
            return [...document.querySelectorAll('a[href]')]
                .map(a => ({ text: a.textContent.trim().substring(0, 30), href: a.href }))
                .filter(x => x.href.includes('opga037') && x.text)
                .slice(0, 50);
        });
        console.log('\n=== 메인 페이지 모든 링크 ===');
        mainLinks.forEach(l => console.log(`  ${l.text} → ${l.href}`));

        console.log('\n브라우저를 직접 보면서 URL 구조 확인하세요. 30초 후 종료...');
        await sleep(30000);

    } catch(e) {
        console.error('오류:', e.message);
    } finally {
        await browser.close();
    }
})();
