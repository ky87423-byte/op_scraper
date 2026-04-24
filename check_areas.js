/**
 * 지역 목록 추출 + addrName별 페이지네이션 확인
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

        await page.goto('https://opga037.com/bbs/board.php?bo_table=op_partner_posting', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);

        // addrName 수집 + HTML 구조 파악
        const data = await page.evaluate(() => {
            // 모든 링크에서 addrName 추출
            const addrNames = [...new Set(
                [...document.querySelectorAll('a[href*="addrName="]')]
                    .map(a => {
                        try { return decodeURIComponent(new URL(a.href).searchParams.get('addrName') || ''); }
                        catch(e) { return ''; }
                    })
                    .filter(Boolean)
            )];

            // cat 코드 추출 (지역 코드)
            const catMap = {};
            [...document.querySelectorAll('a[href*="addrName="]')].forEach(a => {
                try {
                    const u = new URL(a.href);
                    const addr = decodeURIComponent(u.searchParams.get('addrName') || '');
                    const cat = u.searchParams.get('cat');
                    if (addr && cat && !catMap[addr]) catMap[addr] = cat;
                } catch(e) {}
            });

            // 페이지 전체 HTML에서 at-* 클래스 확인
            const atClasses = [...new Set(
                [...document.querySelectorAll('[class*="at-"]')].map(el => el.className)
            )].slice(0, 20);

            // 총 업소 수 관련 텍스트
            const bodyText = document.body.innerText;
            const totalMatch = bodyText.match(/전체\s*(\d+)|총\s*(\d+)/g);

            // 사이드 메뉴에서 지역 리스트 찾기
            const sideRegions = [...document.querySelectorAll('ul li a, .region a, .area a, .location a, aside a')]
                .filter(a => {
                    const text = a.textContent.trim();
                    return text.length > 0 && text.length < 10 && /[가-힣]/.test(text);
                })
                .map(a => a.textContent.trim())
                .slice(0, 50);

            return { addrNames, catMap, atClasses, totalMatch, sideRegions };
        });

        console.log('=== addrName 목록 ===');
        console.log('발견된 addrName:', data.addrNames);
        console.log('\n=== addrName → cat 코드 ===');
        console.log(data.catMap);
        console.log('\n=== at-* 클래스 ===');
        console.log(data.atClasses);
        console.log('\n=== 총 관련 텍스트 ===');
        console.log(data.totalMatch);
        console.log('\n=== 사이드 지역 링크 ===');
        console.log(data.sideRegions);

        // addrName=강남 으로 페이지 테스트
        console.log('\n=== addrName=강남 페이지 테스트 ===');
        for (let p = 1; p <= 5; p++) {
            await page.goto(`https://opga037.com/bbs/board.php?bo_table=op_partner_posting&addrName=%EA%B0%95%EB%82%A8&page=${p}`, {
                waitUntil: 'networkidle2', timeout: 20000
            });
            await sleep(1000);

            const result = await page.evaluate(() => {
                const links = [...document.querySelectorAll('a[href*="wr_id"]')]
                    .filter(a => !a.href.includes('delete') && !a.href.includes('reply') && !a.href.includes('move'));

                const wr_ids = [...new Set(links.map(a => {
                    try { return new URL(a.href).searchParams.get('wr_id'); }
                    catch(e) { return null; }
                }).filter(Boolean))];

                const pageNums = [...document.querySelectorAll('a[href*="page="]')]
                    .map(a => { try { return parseInt(new URL(a.href).searchParams.get('page')); } catch(e) { return 0; } })
                    .filter(n => n > 0);

                return {
                    url: location.href,
                    totalLinks: links.length,
                    uniqueWrIds: wr_ids.length,
                    maxPage: pageNums.length ? Math.max(...pageNums) : 1,
                    firstWrId: wr_ids[0] || '',
                    lastWrId: wr_ids[wr_ids.length - 1] || '',
                };
            });

            console.log(`  p.${p}: total=${result.totalLinks} unique_wr=${result.uniqueWrIds} maxPage=${result.maxPage} | ${result.firstWrId}...${result.lastWrId}`);
            if (result.uniqueWrIds === 0) break;
        }

        // upsoguide (업체별이용가이드) 확인 - 전체 업소 목록일 수 있음
        console.log('\n=== upsoguide 게시판 확인 ===');
        await page.goto('https://opga037.com/bbs/board.php?bo_table=upsoguide', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);
        const upsog = await page.evaluate(() => {
            const links = [...document.querySelectorAll('a[href*="wr_id"]')]
                .filter(a => !a.href.includes('delete'));
            const pageNums = [...document.querySelectorAll('a[href*="page="]')]
                .map(a => { try { return parseInt(new URL(a.href).searchParams.get('page')); } catch(e) { return 0; } })
                .filter(n => n > 0);
            return {
                linkCount: links.length,
                maxPage: pageNums.length ? Math.max(...pageNums) : 1,
                sample: links.slice(0, 3).map(a => a.textContent.trim().substring(0, 40)),
                title: document.title,
            };
        });
        console.log(`업체별이용가이드: ${upsog.linkCount}개, maxPage=${upsog.maxPage}`);
        console.log('샘플:', upsog.sample);

    } catch(e) {
        console.error('오류:', e.message, '\n', e.stack);
    } finally {
        await browser.close();
    }
})();
